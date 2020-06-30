# Nacos-配置中心-动态感知（客户端篇）

## 前戏

* 版本问题：
    * Nacos版本1.2.1
    * Spring-Cloud-Alibaba版本2.2.1
    * Nacos Client SDK版本1.2.1
* 部分代码会将不重要的地方忽略，导致变量找不到声明和赋值地方，这都不重要。
* `//...`表示省略了部分无关代码



## 客户端订阅机制

​		对于配置中心来说，无非就是对配置信息的CRUD，这些都不重要，重要的是客户端是如何去动态感知配置信息发生了变化。

​		动态感知，感知优先，客户端是怎么知道配置变化了呢，其实是用了订阅机制，通过事件监听，来通知配置的变化。

### registerNacosListener

​		先看一下SCA的NacosContextRefresher类，当上下文准备就绪后，会触发ApplicationReadyEvent事件，这个类会对这个事件进行处理：

```java
//com.alibaba.cloud.nacos.refresh.NacosContextRefresher
public class NacosContextRefresher
      implements ApplicationListener<ApplicationReadyEvent>, ApplicationContextAware {
   //...
  
   @Override
   public void onApplicationEvent(ApplicationReadyEvent event) {
      // many Spring context
      if (this.ready.compareAndSet(false, true)) {
         this.registerNacosListenersForApplications();
      }
   }
  
	 //...

   private void registerNacosListenersForApplications() {
      if (isRefreshEnabled()) {
         for (NacosPropertySource propertySource : NacosPropertySourceRepository.getAll()) {
            if (!propertySource.isRefreshable()) {
               continue;
            }
            String dataId = propertySource.getDataId();
            registerNacosListener(propertySource.getGroup(), dataId);
         }
      }
   }

   private void registerNacosListener(final String groupKey, final String dataKey) {
      String key = NacosPropertySourceRepository.getMapKey(dataKey, groupKey);
      Listener listener = listenerMap.computeIfAbsent(key,
            lst -> new AbstractSharedListener() {
               @Override
               public void innerReceive(String dataId, String group,String configInfo) {
                  refreshCountIncrement();
                 	//加记录
                  nacosRefreshHistory.addRefreshRecord(dataId, group, configInfo);
                  // todo feature: support single refresh for listening
                  applicationContext.publishEvent(new RefreshEvent(this, null, "Refresh Nacos config"));
                  //...
               }
            });
      try {
         //使用nacos config  注册监听器
         configService.addListener(dataKey, groupKey, listener);
      }
      catch (NacosException e) {
      }
   }
}
```

​		由于spring上下文比较多，可能会发多个就绪事件，所以使用了CAS保证注册只执行一次。还可以看到会对配置的变更记录记性保存，然后使用NacosConfig注册监听器。当配置发生变化时，就会发布一个RefreshEvent事件，对于这个事件监听的处理在SCA中的RefreshEventListener类中：

```java
//org.springframework.cloud.endpoint.event.RefreshEventListener#onApplicationEvent
@Override
public void onApplicationEvent(ApplicationEvent event) {
   if (event instanceof ApplicationReadyEvent) {
      handle((ApplicationReadyEvent) event);
   }
   else if (event instanceof RefreshEvent) {
      handle((RefreshEvent) event);
   }
}

public void handle(RefreshEvent event) {
    if (this.ready.get()) { // don't handle events before app is ready
      log.debug("Event received " + event.getEventDesc());
      Set<String> keys = this.refresh.refresh();
      log.info("Refresh keys changed: " + keys);
    }
}
```

​		最后，处理方法其实就是调用了refresh.refresh()方法。

​		`org.springframework.cloud.context.refresh.ContextRefresher#refresh`这个方法其实是Cloud体系内的实现，这里就不进行继续分析了。

### addTenantListeners

​		再回过头来看一下registerNacosListener方法中的configService.addListener方法。它调用的是Nacos中`com.alibaba.nacos.client.config.NacosConfigService#addListener`的实现：

```java
@Override
public void addListener(String dataId, String group, Listener listener) throws NacosException {
    worker.addTenantListeners(dataId, group, Arrays.asList(listener));
}

public void addTenantListeners(String dataId, String group, List<? extends Listener> listeners) throws 
    NacosException {
    group = null2defaultGroup(group);//group判空处理
    String tenant = agent.getTenant();
  	//获取缓存
    CacheData cache = addCacheDataIfAbsent(dataId, group, tenant);
    for (Listener listener : listeners) {
      cache.addListener(listener);
    }
}

public CacheData addCacheDataIfAbsent(String dataId, String group, String tenant) throws NacosException {
    CacheData cache = getCache(dataId, group, tenant);
    if (null != cache) {
      return cache;
    }
    String key = GroupKey.getKeyTenant(dataId, group, tenant);
    synchronized (cacheMap) {
      CacheData cacheFromMap = getCache(dataId, group, tenant);
      // multiple listeners on the same dataid+group and race condition,so
      // double check again
      // other listener thread beat me to set to cacheMap
      if (null != cacheFromMap) {
        cache = cacheFromMap;
        // reset so that server not hang this check
        cache.setInitializing(true);
      } else {
        cache = new CacheData(configFilterChainManager, agent.getName(), dataId, group, tenant);
        // fix issue # 1317
        if (enableRemoteSyncConfig) {
          String[] ct = getServerConfig(dataId, group, tenant, 3000L);
          cache.setContent(ct[0]);
        }
      }
      Map<String, CacheData> copy = new HashMap<String, CacheData>(cacheMap.get());
      copy.put(key, cache);
      cacheMap.set(copy);
    }
		//...
    return cache;
}
```

​		对于监听器的操作都封装在了ClientWorker类中。当获取到CacheData后，会把监听器交给它管理。

​		addCacheDataIfAbsent在获取缓存过程中，如果不存，就会创建新的CacheData，并且设置isInitializing属性为true，这是为了首测去Nacos服务端获取数据不会被hold住，可以及时的返回，详细后面会介绍。这里还有个关键方法getServerConfig，去Nacos服务端获取数据的方法，可以看到超时时间3s，这个方法后面也会出现，放在后面分析。	

​		我们接下来重点分析下客户的是如何动态的感知配置信息的变化。



## 客户端动态监听

### 总述

​		通常服务端和客户端之间的数据交互无非就是两种模式：Pull 或 Push。

​		这两种模式没有真正意义上的优劣之分，仅仅是去判断哪种方式更适合我们的业务场景。

​		Pull模式下，客户端通过定时轮询的方式去询问服务端数据是否更新或者直接拉取数据进行更新。但是这种模式不能保证数据更新的实时性，并且即使数据没有更新，客户端也会进行Pull，造成资源的浪费以及做了无用功。

​		Push模式下，服务端主动通知客户端数据发生了变化，实时性是有了，但是服务端需要维持和客户端的长连接，还要加入健康检查来确保连接的可用性，这部分在客户端量很大时，资源浪费严重。

​		那么问题来了，Nacos使用的是哪种模式呢？可以算是Pull模式，但并不是简单的Pull，而是一种长轮询机制，它融合了Push和Pull的优点。那这种机制究竟是什么样的呢？当客户端发起Pull请求后，服务端如果数据有变化就直接返回；如果没有变化，服务端hold住请求，也就是一段时间内不返回结果，直到数据发生变化，服务端会把这个hold住的请求进行返回。

​		在Nacos中，服务端收到Pull请求后，会先检查配置是否发生了变化，如果没有就设置一个定时任务，延迟29.5s处理，并把长轮询连接加到allSubs队列当中，导致这次请求返回有两个情况：

* 一是等到29.5s后触发自动检查机制，这时配置有没有发生变化都会返回结果，29.5s就是长连接的存活时间。
* 二是在这29.5s之间发生了配置的变化，Nacos会在allSubs队列中找到对应的ClientLongPolling任务，将变化的配置返回给对应的客户端，就好像一次“Push”。

### ClientWorker

​		长轮询相关的功能入口在哪呢，其实就是CLientWorker这个类，这个类包含了很多跟监听相关的方法，那他是怎么构造出来的呢？

```java
//com.alibaba.nacos.api.NacosFactory#createConfigService(java.util.Properties)
public static ConfigService createConfigService(Properties properties) throws NacosException {
    return ConfigFactory.createConfigService(properties);
}

//com.alibaba.nacos.api.config.ConfigFactory#createConfigService(java.util.Properties)
public static ConfigService createConfigService(Properties properties) throws NacosException {
    try {
      Class<?> driverImplClass = Class.forName("com.alibaba.nacos.client.config.NacosConfigService");
      Constructor constructor = driverImplClass.getConstructor(Properties.class);
      ConfigService vendorImpl = (ConfigService) constructor.newInstance(properties);
      return vendorImpl;
    } catch (Throwable e) {
      throw new NacosException(NacosException.CLIENT_INVALID_PARAM, e);
    }
}

//com.alibaba.nacos.client.config.NacosConfigService#NacosConfigService
public NacosConfigService(Properties properties) throws NacosException {
    String encodeTmp = properties.getProperty(PropertyKeyConst.ENCODE);
    if (StringUtils.isBlank(encodeTmp)) {
      encode = Constants.ENCODE;
    } else {
      encode = encodeTmp.trim();
    }
    initNamespace(properties);
    agent = new MetricsHttpAgent(new ServerHttpAgent(properties));
    agent.start();
    worker = new ClientWorker(agent, configFilterChainManager, properties);
}
```

​		可以看出，CLientWorker是随着NacosConfigService的创建而构造出来的，而NacosConfigService是由工厂类通过反射创建的。

​		在NacosConfigService的构造函数中，HttpAgent使用的是他的实现类MetricsHttpAgent的对象，而MetricsHttpAgent构造函数的入参是ServerHttpAgent对象，能看出来MetricsHttpAgent其实是用了装饰器模式，ServerHttpAgent才是实际干活的。而最后又将这个HttpAgent交给了ClientWorker，说明worker会用到这个agent进行和Nacos服务端进行http通信。

​		再分析一下ClientWorker的构造方法：

```java
public ClientWorker(final HttpAgent agent, final ConfigFilterChainManager configFilterChainManager, final 
                    Properties properties) {
    this.agent = agent;
    this.configFilterChainManager = configFilterChainManager;
    // Initialize the timeout parameter
    init(properties);
  
    executor = Executors.newScheduledThreadPool(1, new ThreadFactory() {
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r);
            t.setName("com.alibaba.nacos.client.Worker." + agent.getName());
            t.setDaemon(true);
            return t;
        }
    });

    executorService = Executors.newScheduledThreadPool(Runtime.getRuntime().availableProcessors(), new 
                                                       ThreadFactory() {
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r);
            t.setName("com.alibaba.nacos.client.Worker.longPolling." + agent.getName());
            t.setDaemon(true);
            return t;
        }
    });

    executor.scheduleWithFixedDelay(new Runnable() {
        @Override
        public void run() {
            try {
                checkConfigInfo();
            } catch (Throwable e) {
                LOGGER.error("[" + agent.getName() + "] [sub-check] rotate check error", e);
            }
        }
    }, 1L, 10L, TimeUnit.MILLISECONDS);
}
```

​		这个构造方法主要是初始化了一些配置，例如长轮询超时时间等；还创建了两个线程池，并启动了一个线程池。这个线程延时1ms，在前一次任务执行完毕后10ms再执行。执行的方法是checkConfigInfo，用来检查配置信息。

```java
public void checkConfigInfo() {
    // 分任务
    int listenerSize = cacheMap.get().size();
    // 向上取整为批数
    int longingTaskCount = (int) Math.ceil(listenerSize / ParamUtil.getPerTaskConfigSize());
    if (longingTaskCount > currentLongingTaskCount) {
        for (int i = (int) currentLongingTaskCount; i < longingTaskCount; i++) {
            // 要判断任务是否在执行 这块需要好好想想。 任务列表现在是无序的。变化过程可能有问题
            executorService.execute(new LongPollingRunnable(i));
        }
        currentLongingTaskCount = longingTaskCount;
    }
}
```

​		这部分是将坚挺器进行了分组，默认3000个监听器由一个LongPollingRunnable来处理。 

### LongPollingRunnable

​		下面就走进又一重点——LongPollingRunnable，它是一个Runnable的实现类，所以我们来看run方法：

```java
//com.alibaba.nacos.client.config.impl.ClientWorker.LongPollingRunnable#run
@Override
public void run() {
    List<CacheData> cacheDatas = new ArrayList<CacheData>();
    List<String> inInitializingCacheList = new ArrayList<String>();
    try {
        // check failover config
        for (CacheData cacheData : cacheMap.get().values()) {
            if (cacheData.getTaskId() == taskId) {
                cacheDatas.add(cacheData);
                try {
                    checkLocalConfig(cacheData);
                    if (cacheData.isUseLocalConfigInfo()) {
                        cacheData.checkListenerMd5();
                    }
                } catch (Exception e) {
                }
            }
        }
        // check server config
        List<String> changedGroupKeys = checkUpdateDataIds(cacheDatas, inInitializingCacheList);
        for (String groupKey : changedGroupKeys) {
            String[] key = GroupKey.parseKey(groupKey);
            String dataId = key[0];
            String group = key[1];
            String tenant = null;
            if (key.length == 3) {
                tenant = key[2];
            }
            try {
                String[] ct = getServerConfig(dataId, group, tenant, 3000L);
                CacheData cache = cacheMap.get().get(GroupKey.getKeyTenant(dataId, group, tenant));
                cache.setContent(ct[0]);
                if (null != ct[1]) {
                    cache.setType(ct[1]);
                }
            } catch (NacosException ioe) {
            }
        }
        for (CacheData cacheData : cacheDatas) {
            if (!cacheData.isInitializing() || inInitializingCacheList
                .contains(GroupKey.getKeyTenant(cacheData.dataId, cacheData.group, cacheData.tenant))) {
                cacheData.checkListenerMd5();
                cacheData.setInitializing(false);
            }
        }
        inInitializingCacheList.clear();
        executorService.execute(this);
    } catch (Throwable e) {
       	// If the rotation training task is abnormal, the next execution time of the task will be punished
        executorService.schedule(this, taskPenaltyTime, TimeUnit.MILLISECONDS);
    }
}
```

​		首先它根据taskId来检查属于自己管辖的数据的本地数据：

```java
private void checkLocalConfig(CacheData cacheData) {
    final String dataId = cacheData.dataId;
    final String group = cacheData.group;
    final String tenant = cacheData.tenant;
    File path = LocalConfigInfoProcessor.getFailoverFile(agent.getName(), dataId, group, tenant);
    // 没有 -> 有
    if (!cacheData.isUseLocalConfigInfo() && path.exists()) {
        String content = LocalConfigInfoProcessor.getFailover(agent.getName(), dataId, group, tenant);
        String md5 = MD5Utils.md5Hex(content, Constants.ENCODE);
        cacheData.setUseLocalConfigInfo(true);
        cacheData.setLocalConfigInfoVersion(path.lastModified());
        cacheData.setContent(content);
        return;
    }
    // 有 -> 没有。不通知业务监听器，从server拿到配置后通知。
    if (cacheData.isUseLocalConfigInfo() && !path.exists()) {
        cacheData.setUseLocalConfigInfo(false);
        return;
    }
    // 有变更
    if (cacheData.isUseLocalConfigInfo() && path.exists()
        && cacheData.getLocalConfigInfoVersion() != path.lastModified()) {
        String content = LocalConfigInfoProcessor.getFailover(agent.getName(), dataId, group, tenant);
        String md5 = MD5Utils.md5Hex(content, Constants.ENCODE);
        cacheData.setUseLocalConfigInfo(true);
        cacheData.setLocalConfigInfoVersion(path.lastModified());
        cacheData.setContent(content);
    }
}
```

​		checkLocalConfig方法主要是三个判断：

* 第一个判断：不用本地的，但是本地存在，那就用本地的，设置为true。
* 第二个判断：用本地的，但是本地没有，那就设置成不用本地的，去Nacos服务端获取配置
* 第三个判断：用本地的，本地也有，并且版本号不一样，说明有变更，那就把本地的更新到内存里。

​        回到run方法中，这里有个有趣的东西，`cacheData.getTaskId() == taskId`这段代码的getTaskId方法只能得到0，为什么呢？我查了一下setTaskId方法的引用，发现只有`com.alibaba.nacos.client.config.impl.ClientWorker#addCacheDataIfAbsent(java.lang.String, java.lang.String)`调用了，而addCacheDataIfAbsent这个方法只有`com.alibaba.nacos.client.config.impl.ClientWorker#addListeners`调用了，但是addListeners没有地方调用它，我全局搜了下也没找到，难道有反射调用我没找到？不得而知，姑且认为就是没调用它的。那么这个检查本地操作，也就只能检查默认的3000个配置，因为，默认taskId是0，这才能匹配上。

​		接下来就是checkUpdateDataIds方法，检查配置是不是更新了：

```java
//com.alibaba.nacos.client.config.impl.ClientWorker
List<String> checkUpdateDataIds(List<CacheData> cacheDatas, List<String> inInitializingCacheList) throws IOException {
    StringBuilder sb = new StringBuilder();
    for (CacheData cacheData : cacheDatas) {
        if (!cacheData.isUseLocalConfigInfo()) {
            sb.append(cacheData.dataId).append(WORD_SEPARATOR);
            sb.append(cacheData.group).append(WORD_SEPARATOR);
            if (StringUtils.isBlank(cacheData.tenant)) {
                sb.append(cacheData.getMd5()).append(LINE_SEPARATOR);
            } else {
                sb.append(cacheData.getMd5()).append(WORD_SEPARATOR);
                sb.append(cacheData.getTenant()).append(LINE_SEPARATOR);
            }
            if (cacheData.isInitializing()) {
                // cacheData 首次出现在cacheMap中&首次check更新
                inInitializingCacheList
                    .add(GroupKey.getKeyTenant(cacheData.dataId, cacheData.group, cacheData.tenant));
            }
        }
    }
    boolean isInitializingCacheList = !inInitializingCacheList.isEmpty();
    return checkUpdateConfigStr(sb.toString(), isInitializingCacheList);
}

List<String> checkUpdateConfigStr(String probeUpdateString, boolean isInitializingCacheList) throws IOException {
				//...
        // told server do not hang me up if new initializing cacheData added in
        if (isInitializingCacheList) {
            headers.add("Long-Pulling-Timeout-No-Hangup");
            headers.add("true");
        }
				//...
        try {
            // In order to prevent the server from handling the delay of the client's long task,
            // increase the client's read timeout to avoid this problem.
            long readTimeoutMs = timeout + (long) Math.round(timeout >> 1);
            HttpResult result = agent.httpPost(Constants.CONFIG_CONTROLLER_PATH + "/listener", headers, params,
                agent.getEncode(), readTimeoutMs);
            if (HttpURLConnection.HTTP_OK == result.code) {
                setHealthServer(true);
                return parseUpdateDataIdResponse(result.content);
            } else {
                setHealthServer(false);
            }
        } catch (IOException e) {
            setHealthServer(false);
            throw e;
        }
        return Collections.emptyList();
    }
```

​		checkUpdateDataIds会批量对配置进行检查，cacheData 首次出现在cacheMap中&首次check更新时会被加入inInitializingCacheList初始化列表里，最后由checkUpdateConfigStr完成和Nacos服务端的交互。

​		在checkUpdateConfigStr方法中可以看到要检查的配置里有要初始化的配置就会在http的head中加入Long-Pulling-Timeout-No-Hangup来表明让Nacos服务端对这次请求不要hold住。往下的httpPost方法是通过http和Nacos服务端通信，接口是`/configs/listener`,它的超时参数是readTimeoutMs，默认超时时间会比30s大一些，是为了防止服务器处理客户端的长任务的延迟，增加客户端的读取超时以避免此问题。

​		checkUpdateDataIds只是得到了发生变化的配置是哪些，真正获取配置的事后面的getServerConfig方法。

```java
//com.alibaba.nacos.client.config.impl.ClientWorker
public String[] getServerConfig(String dataId, String group, String tenant, long readTimeout)
    throws NacosException {
    String[] ct = new String[2];
		//...
    HttpResult result = null;
    try {
        List<String> params = null;
        //...
        result = agent.httpGet(Constants.CONFIG_CONTROLLER_PATH, null, params, agent.getEncode(), readTimeout);
    } catch (IOException e) {
        throw new NacosException(NacosException.SERVER_ERROR, e);
    }
    switch (result.code) {
        case HttpURLConnection.HTTP_OK:
            LocalConfigInfoProcessor.saveSnapshot(agent.getName(), dataId, group, tenant, result.content);
            ct[0] = result.content;
            if (result.headers.containsKey(CONFIG_TYPE)) {
                ct[1] = result.headers.get(CONFIG_TYPE).get(0);
            } else {
                ct[1] = ConfigType.TEXT.getType();
            }
            return ct;
        //...
    }
}
```

​		发送http请求向Nacos获取最新数据，接口是`/configs`，超时时间3s，再调用LocalConfigInfoProcessor.saveSnapshot根据配置决定是不是要在本地保存一份。

​		run方法中接下来就要进行对配置的检查了：

```java
//com.alibaba.nacos.client.config.impl.ClientWorker.LongPollingRunnable#run
@Override
public void run() {
    try{
      //...
      for (CacheData cacheData : cacheDatas) {
        if (!cacheData.isInitializing() || inInitializingCacheList
            .contains(GroupKey.getKeyTenant(cacheData.dataId, cacheData.group, cacheData.tenant))) {
          cacheData.checkListenerMd5();
          cacheData.setInitializing(false);
        }
      }
      inInitializingCacheList.clear();
      executorService.execute(this);
    } catch (Throwable e) {
      // If the rotation training task is abnormal, the next execution time of the task will be punished
      executorService.schedule(this, taskPenaltyTime, TimeUnit.MILLISECONDS);
    }
}
```

​		如果不是正在初始化的或者是在初始化集合里存在的，那就进行检查。最后再次投递这个任务，如果抛了异常，投递任务会有时间惩罚。我们来看一下是如何检查的：

```java
//com.alibaba.nacos.client.config.impl.CacheData
void checkListenerMd5() {
    for (ManagerListenerWrap wrap : listeners) {
        if (!md5.equals(wrap.lastCallMd5)) {
            safeNotifyListener(dataId, group, content, type, md5, wrap);
        }
    }
}

private void safeNotifyListener(final String dataId, final String group, final String content, final String 
                                type,final String md5, final ManagerListenerWrap listenerWrap) {
    final Listener listener = listenerWrap.listener;
    Runnable job = new Runnable() {
      @Override
      public void run() {
        ClassLoader myClassLoader = Thread.currentThread().getContextClassLoader();
        ClassLoader appClassLoader = listener.getClass().getClassLoader();
        try {
          if (listener instanceof AbstractSharedListener) {
            //将监听器封装
            AbstractSharedListener adapter = (AbstractSharedListener) listener;
            adapter.fillContext(dataId, group);
          }
          // 执行回调之前先将线程classloader设置为具体webapp的classloader，
          //以免回调方法中调用spi接口是出现异常或错用（多应用部署才会有该问题）。
          Thread.currentThread().setContextClassLoader(appClassLoader);
          ConfigResponse cr = new ConfigResponse();
          cr.setDataId(dataId);
          cr.setGroup(group);
          cr.setContent(content);
          configFilterChainManager.doFilter(null, cr);
          String contentTmp = cr.getContent();
          //调用监听器的处理方法
          listener.receiveConfigInfo(contentTmp);

          // compare lastContent and content
          if (listener instanceof AbstractConfigChangeListener) {
            Map data = ConfigChangeHandler.getInstance().parseChangeData(listenerWrap.lastContent, content, 
                                                                         type);
            ConfigChangeEvent event = new ConfigChangeEvent(data);
            ((AbstractConfigChangeListener)listener).receiveConfigChange(event);
            listenerWrap.lastContent = content;
          }
        } catch (NacosException de) {
        } catch (Throwable t) {
        } finally {
          Thread.currentThread().setContextClassLoader(myClassLoader);
        }
      }
    };
    final long startNotify = System.currentTimeMillis();
    try {
      if (null != listener.getExecutor()) {
        listener.getExecutor().execute(job);
      } else {
        job.run();
      }
    } catch (Throwable t) {
    }
}
```

​		循环检查是否有配置发生了变化，有的话要通过safeNotifyListener发通知。

​		在safeNotifyListener方法中，创建了一个任务来处理通知。首先将监听器封装成了AbstractSharedListener，然后再调用其receiveConfigInfo方法进行通知。不知道你是否对AbstractSharedListener还有印象，它其实就是前面讲到的客户端订阅机制中registerNacosListener方法里创建的那个监听器，所以最终也是调用这个监听器的innerReceive方法。

​		至此，动态感知客户端的部分就分享这些，下一篇来分享下服务端是如何处理长轮询的。



​				

