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
```

​	

