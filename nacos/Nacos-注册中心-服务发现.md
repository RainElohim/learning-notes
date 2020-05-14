# Nacos-注册中心-服务发现

[toc]

## 服务地址查询

​		OpenAPI形式为：

```shell
curl -X GET 'http://127.0.0.1:8848/nacos/v1/ns/instance/list?serviceName=nacos.naming.serviceName'
```

​		找到入口后，我们直接来Nacos-Naming模块下的InstanceController中：

```java
@GetMapping("/list")
public JSONObject list(HttpServletRequest request) throws Exception {
  	//获取参数省略...
  
    return doSrvIPXT(namespaceId, serviceName, agent, clusters, clientIP, udpPort, env, 
                     isCheck, app, tenant,healthyOnly);
}

public JSONObject doSrvIPXT(String namespaceId, String serviceName, String agent, String 
                            clusters, String clientIP,int udpPort,String env, 
                            boolean isCheck, String app, String tid, boolean healthyOnly)
  													throws Exception {

  ClientInfo clientInfo = new ClientInfo(agent);
  JSONObject result = new JSONObject();
  //获取service
  Service service = serviceManager.getService(namespaceId, serviceName);
  //...
	//检查service是不是enable状态
  checkIfDisabled(service);

  long cacheMillis = switchDomain.getDefaultCacheMillis();
  try {
    if (udpPort > 0 && pushService.canEnablePush(agent)) {
			//创建用于进行push的client
      pushService.addClient(namespaceId, serviceName,clusters,agent,
                            new InetSocketAddress(clientIP, udpPort),
                            pushDataSource,tid,app);
      cacheMillis = switchDomain.getPushCacheMillis(serviceName);
    }
  } catch (Exception e) {
    cacheMillis = switchDomain.getDefaultCacheMillis();
  }
  //获取service下所有实例的相关信息
  List<Instance> srvedIPs;
  srvedIPs = service.srvIPs(Arrays.asList(StringUtils.split(clusters, ",")));

  // 路由，如果在后台设置了标签路由，就会根据规则选出来这个消费者能用的实例
  if (service.getSelector() != null && StringUtils.isNotBlank(clientIP)) {
    srvedIPs = service.getSelector().select(clientIP, srvedIPs);
  }
  //...
  JSONArray hosts = new JSONArray();
  for (Map.Entry<Boolean, List<Instance>> entry : ipMap.entrySet()) {
    //设置hosts的json...
  }
  //设置result的json...
  return result;
}
```

​		这个方法挺长的，但是有一些意义真心不大，isCheck参数JAVA SDK并没传所以是false，healthyOnly JAVA SDK里写死传的false。

​		再说下doSrvIPXT的大体流程：

  * 首先根据 namespaceId 和serviceName 获取service

  * 初始化push通知用的client信息

  * 从service中使用srvIPs获取到所有服务提供者实例信息

  * 如果有路由规则，则进行过滤，最后封装json

    有关push部分，会在下一小节动态感知里去分析他~



## 服务变更动态感知

​		对于注册了的服务信息发生变更的感知，就好像健康检查那样，客户端和服务端两侧都有相应的策略来保证对其动态感知，先来看下客户端方面：

### 客户端

​		我们想感知到服务信息的变化，首要的方法当然是对这个服务进行监听，这是通常手段。在Nacos中，我们可以使用Nacos SDK中NacosNamingService.subscribe方法，也可以使用NacosNamingService.selectInstances方法，通过入参去控制是否触发监听。

