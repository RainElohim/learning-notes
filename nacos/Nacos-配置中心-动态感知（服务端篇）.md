# Nacos-配置中心-动态感知（服务端篇）

## 前言

​		在上一篇——客户端篇中，我们了解到了客户端的LongPollingRunnable通过调用checkUpdateDataIds方法向服务端发起长轮询，当配置未发生变化时将会被挂起，配置有修改时会立即返回，从而达到动态感知，那么服务端是如何处理这个的呢？我们今天来分析下服务端的部分。

## POST /configs/listener

```java
//com.alibaba.nacos.config.server.controller.ConfigController
@PostMapping("/listener")
@Secured(action = ActionTypes.READ, parser = ConfigResourceParser.class)
public void listener(HttpServletRequest request, HttpServletResponse response)
  throws ServletException, IOException {
    request.setAttribute("org.apache.catalina.ASYNC_SUPPORTED", true);
    String probeModify = request.getParameter("Listening-Configs");
    if (StringUtils.isBlank(probeModify)) {
        throw new IllegalArgumentException("invalid probeModify");
    }
    probeModify = URLDecoder.decode(probeModify, Constants.ENCODE);
    Map<String, String> clientMd5Map;
    try {
        clientMd5Map = MD5Util.getClientMd5Map(probeModify);
    } catch (Throwable e) {
        throw new IllegalArgumentException("invalid probeModify");
    }
    // do long-polling
    inner.doPollingConfig(request, response, clientMd5Map, probeModify.length());
}
```

​		这段代码中就一个重要的方法doPollingConfig：

```java
public String doPollingConfig(HttpServletRequest request, HttpServletResponse response,
                              Map<String, String> clientMd5Map, int probeRequestSize)
    throws IOException {
    // 长轮询
    if (LongPollingService.isSupportLongPolling(request)) {
        longPollingService.addLongPollingClient(request, response, clientMd5Map, probeRequestSize);
        return HttpServletResponse.SC_OK + "";
    }
    // else 兼容短轮询逻辑
    List<String> changedGroups = MD5Util.compareMd5(request, response, clientMd5Map);
    // 兼容短轮询result
    String oldResult = MD5Util.compareMd5OldResult(changedGroups);
    String newResult = MD5Util.compareMd5ResultString(changedGroups);
    String version = request.getHeader(Constants.CLIENT_VERSION_HEADER);
    if (version == null) {
        version = "2.0.0";
    }
    int versionNum = Protocol.getVersionNumber(version);
    /**
     * 2.0.4版本以前, 返回值放入header中
     */
    if (versionNum < START_LONGPOLLING_VERSION_NUM) {
        response.addHeader(Constants.PROBE_MODIFY_RESPONSE, oldResult);
        response.addHeader(Constants.PROBE_MODIFY_RESPONSE_NEW, newResult);
    } else {
        request.setAttribute("content", newResult);
    }
    // 禁用缓存
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0);
    response.setHeader("Cache-Control", "no-cache,no-store");
    response.setStatus(HttpServletResponse.SC_OK);
    return HttpServletResponse.SC_OK + "";
}
```

​		第一部分就是长轮询的处理，先略过，来看后面的短轮询。通过调用MD5Util.compareMd5方法，将客户端传过来的MD5值和Nacos缓存的MD5值进行比较，如果不同，则说明发生了变化。后面是就是设置返回信息了，就不说了，再看第一部分对于长轮询的处理，显示进行了一个判断，我们来看看LongPollingService.isSupportLongPolling方法干了什么：

```java
//com.alibaba.nacos.config.server.service.LongPollingService
static public final String LONG_POLLING_HEADER = "Long-Pulling-Timeout";
static public boolean isSupportLongPolling(HttpServletRequest req) {
    return null != req.getHeader(LONG_POLLING_HEADER);
}
```

​		原来是判断请求头里有没有`Long-Pulling-Timeout`，如果前文你认真看了，那么就会记得这个是在客户端checkUpdateConfigStr方法中设置的。判断为true后，调用了实际处理的方法：

```java
public void addLongPollingClient(HttpServletRequest req, HttpServletResponse rsp, Map<String, String> 
                                 clientMd5Map,int probeRequestSize) {
    String str = req.getHeader(LongPollingService.LONG_POLLING_HEADER);
    String noHangUpFlag = req.getHeader(LongPollingService.LONG_POLLING_NO_HANG_UP_HEADER);
    String appName = req.getHeader(RequestUtil.CLIENT_APPNAME_HEADER);
    String tag = req.getHeader("Vipserver-Tag");
    int delayTime = SwitchService.getSwitchInteger(SwitchService.FIXED_DELAY_TIME, 500);
    /**
     * 提前500ms返回响应，为避免客户端超时 @qiaoyi.dingqy 2013.10.22改动  add delay time for LoadBalance
     */
    long timeout = Math.max(10000, Long.parseLong(str) - delayTime);
    if (isFixedPolling()) {
        timeout = Math.max(10000, getFixedPollingInterval());
        // do nothing but set fix polling timeout
    } else {
        long start = System.currentTimeMillis();
        List<String> changedGroups = MD5Util.compareMd5(req, rsp, clientMd5Map);
        if (changedGroups.size() > 0) {
            generateResponse(req, rsp, changedGroups);
            return;
        } else if (noHangUpFlag != null && noHangUpFlag.equalsIgnoreCase(TRUE_STR)) {
            return;
        }
    }
    String ip = RequestUtil.getRemoteIp(req);
    // 一定要由HTTP线程调用，否则离开后容器会立即发送响应
    final AsyncContext asyncContext = req.startAsync();
    // AsyncContext.setTimeout()的超时时间不准，所以只能自己控制
    asyncContext.setTimeout(0L);
    scheduler.execute(
        new ClientLongPolling(asyncContext, clientMd5Map, ip, probeRequestSize, timeout, appName, tag));
}
```

​		根据timeout变量看出，默认请求会挂起29.5s，如果支持固定轮询，那默认是10s。接下来判断是否有配置发生了变更，如果有那就立刻返回，或者设置了不允许挂起那也立即返回。如果需要挂起，那就要由scheduler去调度ClientLongPolling任务了，先看下这个scheduler：

```java
//com.alibaba.nacos.config.server.service.LongPollingService#LongPollingService
public LongPollingService() {
    allSubs = new ConcurrentLinkedQueue<ClientLongPolling>();
    scheduler = Executors.newScheduledThreadPool(1, new ThreadFactory() {
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r);
            t.setDaemon(true);
            t.setName("com.alibaba.nacos.LongPolling");
            return t;
        }
    });
    scheduler.scheduleWithFixedDelay(new StatTask(), 0L, 10L, TimeUnit.SECONDS);
}
```

​		scheduler是在LongPollingService的构造函数里创建的。在LongPollingService构造函数里同时创建了allSubs，它由ConcurrentLinkedQueue实例化，来存放ClientLongPolling任务，这个在客户端篇中客户端动态监听小节中提到了，接下来我们还会遇见它。再来继续看scheduler，他是创建了1个线程的线程池，调度时会在上次任务结束后10s才继续进行，并且在这他启动了一个StatTask任务，是记录allSubs的size的，就不详细分析了。

## ClientLongPolling

​		原来ClientLongPolling也是一个线程，那来看看它的run方法：

```java
//com.alibaba.nacos.config.server.service.LongPollingService.ClientLongPolling#run
@Override
public void run() {
    asyncTimeoutFuture = scheduler.schedule(new Runnable() {
        @Override
        public void run() {
            try {
                getRetainIps().put(ClientLongPolling.this.ip, System.currentTimeMillis());
                /**
                 * 删除订阅关系
                 */
                allSubs.remove(ClientLongPolling.this);
                if (isFixedPolling()) {
                    List<String> changedGroups = MD5Util.compareMd5(
                        (HttpServletRequest)asyncContext.getRequest(),
                        (HttpServletResponse)asyncContext.getResponse(), clientMd5Map);
                    if (changedGroups.size() > 0) {
                        sendResponse(changedGroups);
                    } else {
                        sendResponse(null);
                    }
                } else {
                    sendResponse(null);
                }
            } catch (Throwable t) {
            }
        }
    }, timeoutTime, TimeUnit.MILLISECONDS);
    allSubs.add(this);
}
```

​		首先启动了一个延时定时任务，默认延时就是之前传入得timeout参数29.5s，然后将ClientLongPolling自己加入到了allSubs中，它存储的代表订阅关系。在这个延时定时任务执行后，就删除订阅关系，如果不是固定轮询就走else分支直接调用sendResponse取消这个超时任务然后将结果返回。



## DataChangeTask

​		上面只是针对超时的处理，那在hold住期间，配置发生了变化，是如何触发的请求返回呢？我们仔细看下LongPollingService这个类，发现这个类实现了AbstractEventListener接口！再看下onEvent的重写方法：

```java
//com.alibaba.nacos.config.server.service.LongPollingService#onEvent
@Override
public void onEvent(Event event) {
    if (isFixedPolling()) {
        // ignore
    } else {
        if (event instanceof LocalDataChangeEvent) {
            LocalDataChangeEvent evt = (LocalDataChangeEvent)event;
            scheduler.execute(new DataChangeTask(evt.groupKey, evt.isBeta, evt.betaIps));
        }
    }
}
```

​		else分支中判断了一个LocalDataChangeEvent事件，这就很明显了，当配置发生变化话，LongPollingService能监听到事件然后进行处理。还是使用scheduler线程池，投递了一个DataChangeTask任务：

```java
//com.alibaba.nacos.config.server.service.LongPollingService.DataChangeTask#run
@Override
public void run() {
    try {
        ConfigService.getContentBetaMd5(groupKey);
        for (Iterator<ClientLongPolling> iter = allSubs.iterator(); iter.hasNext(); ) {
            ClientLongPolling clientSub = iter.next();
            if (clientSub.clientMd5Map.containsKey(groupKey)) {
                // 如果beta发布且不在beta列表直接跳过
                if (isBeta && !betaIps.contains(clientSub.ip)) {
                    continue;
                }
                // 如果tag发布且不在tag列表直接跳过
                if (StringUtils.isNotBlank(tag) && !tag.equals(clientSub.tag)) {
                    continue;
                }
                getRetainIps().put(clientSub.ip, System.currentTimeMillis());
                iter.remove(); // 删除订阅关系
                clientSub.sendResponse(Arrays.asList(groupKey));
            }
        }
    } catch (Throwable t) {
    }
}
```

​		逻辑就是遍历订阅列表allSubs内的ClientLongPolling，看谁监听了这次发生变化了的配置，如果有就删除订阅关系，将请求返回。

​		到这我们就知道了配置发生变化客户端为什么能够及时发现了。

