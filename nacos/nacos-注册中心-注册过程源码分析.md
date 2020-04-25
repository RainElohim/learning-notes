# Nacos-注册中心-注册过程源码分析

* 版本问题：
    * Nacos版本1.2.1
    * Spring-Cloud-Alibaba版本2.2.1
    * Nacos Client SDK版本1.2.1
* 部分代码会将不重要的地方忽略，导致变量找不到声明和赋值地方，这都不重要。

## 注册入口

​	我们用Spring-Cloud-Alibaba（以下简称SCA）来对nacos注册流程进行探讨。

​		首先要想使用nacos的注册功能，需要先引入注册用的starter。

```xml
<dependency>
  <groupId>com.alibaba.cloud</groupId>
  <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
</dependency>
```

​		Spring-Cloud规范提供了一个ServiceRegistry的接口类用来各种注册中心的快捷接入。对于SCA中的Nacos而言，其具体实现类为NacosServiceRegistry。也就是当触发了ServiceRegistry的register方法其实就是触发了NacosServiceRegistry的register方法。

```java
@Override
public void register(Registration registration) {
  String serviceId = registration.getServiceId();
  String group = nacosDiscoveryProperties.getGroup();
  Instance instance = getNacosInstanceFromRegistration(registration);
  try {
    namingService.registerInstance(serviceId, group, instance);
  }
  catch (Exception e) {
  }
}
```

​		这个starter实际上是调用了Nacos CLient SDK中的NacosNamingService.registerInstance完成注册。

```java
@Override
public void registerInstance(String serviceName, String groupName, Instance instance) throws NacosException {

  if (instance.isEphemeral()) {
    BeatInfo beatInfo = new BeatInfo();
    beatInfo.setServiceName(NamingUtils.getGroupedName(serviceName, groupName));
    beatInfo.setIp(instance.getIp());
    beatInfo.setPort(instance.getPort());
    beatInfo.setCluster(instance.getClusterName());
    beatInfo.setWeight(instance.getWeight());
    beatInfo.setMetadata(instance.getMetadata());
    beatInfo.setScheduled(false);
    beatInfo.setPeriod(instance.getInstanceHeartBeatInterval());

    beatReactor.addBeatInfo(
      NamingUtils.getGroupedName(serviceName, groupName), beatInfo
    );
  }
  serverProxy.registerService(
    NamingUtils.getGroupedName(serviceName, groupName), groupName, instance
  );
}

//Instance 类
public long getInstanceHeartBeatInterval() {
  return this.getMetaDataByKeyWithDefault(
    "preserved.heart.beat.interval",Constants.DEFAULT_HEART_BEAT_INTERVAL
  );
}

//Constants 类
public static final long DEFAULT_HEART_BEAT_INTERVAL;
static {
  DEFAULT_HEART_BEAT_TIMEOUT = TimeUnit.SECONDS.toMillis(15L);
  DEFAULT_IP_DELETE_TIMEOUT = TimeUnit.SECONDS.toMillis(30L);
  DEFAULT_HEART_BEAT_INTERVAL = TimeUnit.SECONDS.toMillis(5L);
}
```

​		NacosNamingService.registerInstance方法主要逻辑就是通过beatReactor.addBeatInfo建立心跳检测机制，其中period是心跳频率默认是5s，健康超时是15s，将ip信息删除是30s。serverProxy.registerService实现服务的注册。

## 心跳机制

### Client端

​		心跳机制是在通过注册服务来触发的，它是保证服务提供者健康状态的重要途径，具体代码如下：

```java
public void addBeatInfo(String serviceName, BeatInfo beatInfo) {
        String key = buildKey(serviceName, beatInfo.getIp(), beatInfo.getPort());
        BeatInfo existBeat = null;
        if ((existBeat = dom2Beat.remove(key)) != null) {
            existBeat.setStopped(true);
        }
        dom2Beat.put(key, beatInfo);
        executorService.schedule(new BeatTask(beatInfo), beatInfo.getPeriod(), 
                                 TimeUnit.MILLISECONDS);
        MetricsMonitor.getDom2BeatSizeMonitor().set(dom2Beat.size());
    }
```

​		由上看出，心跳是Client通过schedule定时发送的。而BeatTask的run方法究竟干了什么，看下面代码：

```java
@Override
public void run() {
  if (beatInfo.isStopped()) {
    return;
  }
  long nextTime = beatInfo.getPeriod();
  try {
    JSONObject result = serverProxy.sendBeat(beatInfo, BeatReactor.this.lightBeatEnabled);
    long interval = result.getIntValue("clientBeatInterval");
    boolean lightBeatEnabled = false;
    if (result.containsKey(CommonParams.LIGHT_BEAT_ENABLED)) {
      lightBeatEnabled = result.getBooleanValue(CommonParams.LIGHT_BEAT_ENABLED);
    }
    BeatReactor.this.lightBeatEnabled = lightBeatEnabled;
    if (interval > 0) {
      nextTime = interval;
    }
    int code = NamingResponseCode.OK;
    if (result.containsKey(CommonParams.CODE)) {
      code = result.getIntValue(CommonParams.CODE);
    }
    if (code == NamingResponseCode.RESOURCE_NOT_FOUND) {
      Instance instance = new Instance();
      instance.setInstanceId(instance.getInstanceId());
      instance.setEphemeral(true);
      //set...
      try {
        //注册
        serverProxy.registerService(
          beatInfo.getServiceName(),
         	NamingUtils.getGroupName(beatInfo.getServiceName()), 
          instance
        );
      } catch (Exception ignore) {
      }
    }
  } catch (NacosException ne) {
    //...
  }
  executorService.schedule(new BeatTask(beatInfo), nextTime, TimeUnit.MILLISECONDS);
}
```

​		通过serverProxy.sendBeat方法向Server端发送心跳请求，实际上也是使用的OpenAPI进行请求的。请求API为（/v1/ns/instance/beat），方法为PUT。

​		如果这个服务不存在，那么就根据心跳信息里的数据构建出服务数据，然后向Server端进行注册。最后将任务从新交由周期线程执行。

### Server端

#### 心跳请求处理

```java
@CanDistro
@PutMapping("/beat")
@Secured(parser = NamingResourceParser.class, action = ActionTypes.WRITE)
public JSONObject beat(HttpServletRequest request) throws Exception {
  JSONObject result = new JSONObject();
  //...
  RsInfo clientBeat = null;
  if (StringUtils.isNotBlank(beat)) {
    clientBeat = JSON.parseObject(beat, RsInfo.class);
  }

  if (clientBeat != null) {
    if (StringUtils.isNotBlank(clientBeat.getCluster())) {
      clusterName = clientBeat.getCluster();
    } else {
      clientBeat.setCluster(clusterName);
    }
    ip = clientBeat.getIp();
    port = clientBeat.getPort();
  }
  //获取服务
  Instance instance = serviceManager.getInstance(
    namespaceId, serviceName, clusterName, ip, port
  );

  if (instance == null) {
    if (clientBeat == null) {
      result.put(CommonParams.CODE, NamingResponseCode.RESOURCE_NOT_FOUND);
      return result;
    }
    instance = new Instance();
    instance.setPort(clientBeat.getPort());
    //set ... from clientBeat
    //没有就注册
    serviceManager.registerInstance(namespaceId, serviceName, instance);
  }

  Service service = serviceManager.getService(namespaceId, serviceName);

  if (service == null) {
    throw new NacosException(NacosException.SERVER_ERROR,
                             "service not found: " + serviceName + "@" + namespaceId);
  }
  if (clientBeat == null) {
    clientBeat = new RsInfo();
    clientBeat.setIp(ip);
    clientBeat.setPort(port);
    clientBeat.setCluster(clusterName);
  }
  //处理心跳信息
  service.processClientBeat(clientBeat);

  result.put(CommonParams.CODE, NamingResponseCode.OK);
  result.put("clientBeatInterval", instance.getInstanceHeartBeatInterval());
  result.put(SwitchEntry.LIGHT_BEAT_ENABLED, switchDomain.isLightBeatEnabled());
  return result;
}
```

​		服务端接收到心跳请求会先根据信息去调用serviceManager.getInstance来获取本地是否已经注册过这个服务了，如果没有就调用serviceManager.registerInstance去创建（Server创建后文会详细讲）。最后调用service.processClientBeat去处理心跳数据。

```java
public void processClientBeat(final RsInfo rsInfo) {
  ClientBeatProcessor clientBeatProcessor = new ClientBeatProcessor();
  clientBeatProcessor.setService(this);
  clientBeatProcessor.setRsInfo(rsInfo);
  HealthCheckReactor.scheduleNow(clientBeatProcessor);
}

public class ClientBeatProcessor implements Runnable {
  @Override
  public void run() {
    Service service = this.service;
    String ip = rsInfo.getIp();
    String clusterName = rsInfo.getCluster();
    int port = rsInfo.getPort();
    Cluster cluster = service.getClusterMap().get(clusterName);
    List<Instance> instances = cluster.allIPs(true);

    for (Instance instance : instances) {
      if (instance.getIp().equals(ip) && instance.getPort() == port) {
        instance.setLastBeat(System.currentTimeMillis());
        if (!instance.isMarked()) {
          if (!instance.isHealthy()) {
            instance.setHealthy(true);
            //udp推送
            getPushService().serviceChanged(service);
          }
        }
      }
    }
  }
}
```

​		Server端会异步去重设这个服务的最后一次心跳时间，并且如果这个服务信息已经变更了，那么就使用PushService通过UDP进行信息的主动推送（变更通知会在后文介绍）。

#### 定时检查

​		上面的介绍并没有提及如果心跳停止，Server将会如何知道和处理的。其实这部分功能是通过异步任务来完成的。这个任务是什么创建的呢，其实是在Service创建的同时进行的，并且5s检查一次：

```java
public class Service extends com.alibaba.nacos.api.naming.pojo.Service 
  implements Record,RecordListener<Instances> {
    @JSONField(serialize = false)
    private ClientBeatCheckTask clientBeatCheckTask = new ClientBeatCheckTask(this);

    public void init() {
      //定时检查
      HealthCheckReactor.scheduleCheck(clientBeatCheckTask);
      for (Map.Entry<String, Cluster> entry : clusterMap.entrySet()) {
        entry.getValue().setService(this);
        entry.getValue().init();
      }
    }
}

//HealthCheckReactor 类
public static void scheduleCheck(ClientBeatCheckTask task) {
  futureMap.putIfAbsent(
    task.taskKey(), EXECUTOR.scheduleWithFixedDelay(task, 5000, 5000, TimeUnit.MILLISECONDS)
  );
}
```

​		这个检查任务的逻辑就是判断当前时间和心跳超时时间以及IP清除超时间比较。心跳超时了就将健康状态置为不健康，并且通过事件进行数据一致性的同步处理；IP清除超时了就通过OpenAPI调用自己来删除Service，OpenAPI为（/v1/ns/instance）,方法为DELETE。

```java

public class ClientBeatCheckTask implements Runnable {
	@Override
  public void run() {
    try {
			//...
      List<Instance> instances = service.allIPs(true);

      // first set health status of instances:
      for (Instance instance : instances) {
        if (System.currentTimeMillis() - instance.getLastBeat() >
            instance.getInstanceHeartBeatTimeOut()) {
          if (!instance.isMarked()) {
            if (instance.isHealthy()) {
              instance.setHealthy(false);
              getPushService().serviceChanged(service);
              //发送事件，同步数据
              SpringContext.getAppContext().publishEvent(
                new InstanceHeartbeatTimeoutEvent(this, instance));
            }
          }
        }
      }
			//...
      // then remove obsolete instances:
      for (Instance instance : instances) {
        if (instance.isMarked()) {
          continue;
        }
        if (System.currentTimeMillis() - instance.getLastBeat() > 
            instance.getIpDeleteTimeout()) {
          // delete instance
          deleteIP(instance);
        }
      }

    } catch (Exception e) {
      Loggers.SRV_LOG.warn("Exception while processing client beat time out.", e);
    }
  }
}

private void deleteIP(Instance instance) {
  try {
    NamingProxy.Request request = NamingProxy.Request.newRequest();
    //...
    String url = "http://127.0.0.1:" + RunningConfig.getServerPort() + 
      RunningConfig.getContextPath() + UtilsAndCommons.NACOS_NAMING_CONTEXT + 
      "/instance?" + request.toUrl();

    // delete instance asynchronously...
    //...
  } catch (Exception e) {
    //...
  }
}
```

#### 小结图示

![Nacos心跳检测示意图](./pic/Nacos-Beat.jpg)

## 注册Instance

### @CanDistro

​		客户端调用了OpenAPI后，进入Nacos的Naming模块中的InstanceController，PUT方法对应着注册Instance，代码如下：

```java
@CanDistro
@PostMapping
@Secured(parser = NamingResourceParser.class, action = ActionTypes.WRITE)
public String register(HttpServletRequest request) throws Exception {
	//...
  serviceManager.registerInstance(namespaceId, serviceName, parseInstance(request));
  return "ok";
}
```

​		我们会发现方法上有个@CanDistro注解。这个注解很重要。它决定着这个请求是不是在这个Nacos实例上进行处理。对请求的处理是通过过滤链来进行判断处理的，我们来结合DistroFilter.doFilter代码具体分析：

```java
@Override
public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, 
                     FilterChain filterChain) throws IOException, ServletException {
  //...
  try {
		//...
    String groupName = req.getParameter(CommonParams.GROUP_NAME);
    if (StringUtils.isBlank(groupName)) {
      groupName = Constants.DEFAULT_GROUP;
    }

    // use groupName@@serviceName as new service name:
    String groupedServiceName = serviceName;
    if (StringUtils.isNotBlank(serviceName) && 
        !serviceName.contains(Constants.SERVICE_INFO_SPLITER)) {
      groupedServiceName = groupName + Constants.SERVICE_INFO_SPLITER + serviceName;
    }

    // proxy request to other server if necessary:
    if (method.isAnnotationPresent(CanDistro.class) && 
        !distroMapper.responsible(groupedServiceName)) {
      //...
      List<String> headerList = new ArrayList<>(16);
      Enumeration<String> headers = req.getHeaderNames();
      while (headers.hasMoreElements()) {
        String headerName = headers.nextElement();
        headerList.add(headerName);
        headerList.add(req.getHeader(headerName));
      }

      String body = IoUtils.toString(req.getInputStream(), Charsets.UTF_8.name());

      HttpClient.HttpResult result =
        HttpClient.request("http://" + distroMapper.mapSrv(groupedServiceName) + 
                           req.getRequestURI(), headerList,
                           HttpClient.translateParameterMap(req.getParameterMap()),
                           body, PROXY_CONNECT_TIMEOUT, PROXY_READ_TIMEOUT, 
                           Charsets.UTF_8.name(), req.getMethod());
			//...resp
      return;
    }
    OverrideParameterRequestWrapper requestWrapper = 
      OverrideParameterRequestWrapper.buildRequest(req);
    requestWrapper.addParameter(CommonParams.SERVICE_NAME, groupedServiceName);
    filterChain.doFilter(requestWrapper, resp);
    //...catch
  } catch (Exception e) {
    resp.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR,
                   "Server failed," + ExceptionUtil.getAllExceptionMsg(e));
    return;
  }
}

public boolean responsible(String serviceName) {
  if (!switchDomain.isDistroEnabled() || SystemUtils.STANDALONE_MODE) {
    return true;
  }
	//...
  int index = healthyList.indexOf(NetUtils.localServer());
  int lastIndex = healthyList.lastIndexOf(NetUtils.localServer());
  if (lastIndex < 0 || index < 0) {
    return true;
  }
	//hash计算
  int target = distroHash(serviceName) % healthyList.size();
  return target >= index && target <= lastIndex;
}
```

​		如果这个方法是不是标注@CanDistro注解，以及经过distroMapper.responsible方法的判断，这个请求不应该由本机处理（通过groupedServiceName和healthyList大小的哈希计算判断），那么就会将这个请求转发给由distroMapper.mapSrv方法（也是和刚才相同的哈希计算方式）算出的Nacos实例来进行处理。

