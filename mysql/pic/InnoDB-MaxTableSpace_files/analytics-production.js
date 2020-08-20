    //---------------------------
    //
    //  analytics Module Code 0.0.3
    //
    //---------------------------
    ORA.analyticsModule = function(){};

    //Object to contain custom configs
    ORA.analyticsModule.prototype.oraConfigObj = {
  "s_disableSeed":false,
  "alwaysLoad":true,
  "ora-plugins":{
    "cg":{
      "enable":true,
      "cgDefs":[
        "wt.cg_l1",
        "wt.cg_l2",
        "wt.cg_l3",
        "wt.cg_l4",
        "wt.cg_l5",
        "wt.cg_l6",
        "wt.cg_l7",
        "wt.cg_l8",
        "wt.cg_l9",
        "wt.cg_l10"
      ],
      "blockCollect":true
    },
    "html5Video":{
      "enable":true,
      "poll":false,
      "pctInc":25,
      "beraconType":"auto",
      "seek":true,
      "pollRate":250,
      "nameCallback":null,
      "beaconCurve":{
        "300":30,
        "60":10,
        "600":60,
        "130":30,
        "420":45,
        "1800":150
      },
      "pause":true,
      "load":false,
      "cued":false,
      "loadMeta":false,
      "screenMode":false,
      "beacon":true,
      "postMessage":false,
      "fixed":false,
      "quartile":true,
      "buffering":false,
      "bins":15,
      "beaconRate":60,
      "metaTags":true,
      "volume":false
    },
    "evtTrack":{
      "enable":true,
      "eventList":{
        "myClick":{
          "eventTrigger":"mousedown",
          "selector":"BUTTON.btnTest",
          "eventCallback":"var el = e[\"element\"] || e[\"srcElement\"] || {},payload = {};payload[\"WT.ti\"] = \"Button:\" + el.textContent || el.innerText;payload[\"WT.dl\"] = \"99\";return {\"data\": payload};"
        }
      },
      "trackSocial":true,
      "standardEvents":{
        "anchor":true,
        "onsite":true,
        "offsite":true,
        "rightclick":true,
        "download":true,
        "javascript":false,
        "scrollTracking":true
      },
      "downloadtypes":"xls,doc,pdf,txt,csv,zip,docx,xlsx,rar,gzip,pptx",
      "socialTypes":{
        "Reddit":[
          "Reddit.com"
        ],
        "Pinterest":[
          "Pinterest.com"
        ],
        "YouTube":[
          "youtube.com"
        ],
        "Meetup":[
          "Meetup.com"
        ],
        "Google+":[
          "plus.google.com"
        ],
        "VK":[
          "VK.com"
        ],
        "Twitter":[
          "Twitter.com"
        ],
        "Odnoklassniki":[
          "Odnoklassniki.ru"
        ],
        "Weibo":[
          "Weibo.com"
        ],
        "Facebook":[
          "www.facebook.com"
        ],
        "Ask.fm":[
          "Ask.fm"
        ],
        "Tumblr":[
          "Tumblr.com"
        ],
        "LinkedIn":[
          "LinkedIn.com"
        ],
        "Instagram":[
          "instagram.com"
        ],
        "Flickr":[
          "Flickr.com"
        ],
        "Qzone":[
          "Qzone.qq.com"
        ]
      }
    },
    "yt":{
      "enable":true,
      "legacy":false,
      "pctInc":25,
      "seek":true,
      "pause":true,
      "load":false,
      "cued":false,
      "loadMeta":false,
      "beacon":true,
      "mode":"auto",
      "quartile":true,
      "buffering":false,
      "loadAPI":false,
      "bins":15,
      "beaconRate":60,
      "volume":false
    },
    "fragment":{
      "virtualPageView":false,
      "prefix":"anchor",
      "blockCollect":true,
      "virtialDl":26,
      "paramHandeling":"addPrefix",
      "addAnchorName":"name",
      "applyClickEventOnly":false
    },
    "bc":{
      "enable":true,
      "poll":false,
      "pctInc":25,
      "beraconType":"auto",
      "seek":true,
      "pollRate":250,
      "nameCallback":null,
      "beaconCurve":{
        "300":30,
        "60":10,
        "600":60,
        "130":30,
        "420":45,
        "1800":150
      },
      "pause":true,
      "load":false,
      "cued":false,
      "preProcess":null,
      "loadMeta":false,
      "screenMode":false,
      "beacon":true,
      "maxBinds":10,
      "postMessage":false,
      "fixed":false,
      "playerId":"div[id^='vjs_video']:not([id$='_api']):not([id*='_component'])",
      "quartile":true,
      "buffering":false,
      "bins":15,
      "beaconRate":60,
      "metaTags":true,
      "volume":false
    },
    "heatmap":{
      "enable":true,
      "maxymiserEnable":false
    },
    "cookieCutter":{
      "readCookies":[
        {
          "cookie":{
            "TEST":"ora.cook_a"
          },
          "options":{
            "persist":true
          }
        },
        {
          "cookie":{
            "ORA_FPC":{
              "id":"ora.c_id",
              "ss":"ora.c_ss",
              "lv":"ora.c_lv"
            }
          },
          "options":{
            "parseOn":":",
            "parseLv":"="
          }
        },
        {
          "cookie":{
            "ELOQUA":{
              "GUID":"ora.eloqua"
            }
          }
        },
        {
          "cookie":{
            "utag_main":{
              "_ss":"ora.u_ss",
              "_st":"ora.u_st",
              "v_id":"ora.u_vid",
              "_sn":"ora.u_sn",
              "ses_id":"ora.u_ses_id"
            }
          },
          "options":{
            "parseOn":"$",
            "parseLv":":",
            "persist":false
          }
        }
      ],
      "enable":true
    },
    "pp":{
      "enable":true,
      "cookieDays":365,
      "priority":100,
      "defPrefix":"DCSext",
      "params":[
        "wt.gcm_uid",
        "wt.p_cookie_att",
        "wt.gcm_uid",
        "wt.p_status",
        "vtid"
      ],
      "useMostRecent":true,
      "cookieName":"WTPERSIST"
    },
    "plt":{
      "enable":true,
      "waitTime":150,
      "sampleRate":50,
      "assetFilter":".*js",
      "maxT":2,
      "enablePerf":false,
      "perfLimit":50
    }
  },
  "timezone":0,
  "enabled":true,
  "DNTBehavior":"honorDNT",
  "skip_qp_no_equals":true,
  "s_dependencies":"common:running",
  "hosted-plugins":{
    "InfinityPlugin":{
      "enable":true,
      "src":"https://www.oracle.com/asset/web/analytics/infinity_common.js",
      "blockCollect":false
    }
  },
  "defaultCollectionServer":"dc.oracleinfinity.io",
  "s_useTrackingPipeline":true,
  "libUrl":"//c.oracleinfinity.io/acs/account/wh3g12c3gg/js/mysql/analytics-production/analytics.js",
  "accountGuid":"wh3g12c3gg",
  "tagId":"mysql",
  "secureCookie":false,
  "destinations":[
    {
      "accountGuid":"wh3g12c3gg"
    }
  ],
  "s_TrackingPipelineTimeout":4000
};

    if (!(typeof ORA.analyticsModule.prototype.oraConfigObj.enabled && ORA.analyticsModule.prototype.oraConfigObj.enabled === false)){


    ORA.analyticsModule.prototype.preinit = function() {
    };

    // run rules
    ORA.analyticsModule.prototype.init = function() {
        try {
                         if(true) {
                           //Rule - simple
                                    this.oraConfigObj.key="value";
                
                                if (this.oraConfigObj.doLoad === undefined) {
                 this.oraConfigObj.doLoad=true;
                }
           }
                    // handle case where it matches none of the rules
            this.oraConfigObj.doLoad = this.oraConfigObj.doLoad || this.oraConfigObj.alwaysLoad;

                    } catch(e) {
            ORA.abortModuleHelper("analytics", e);
        }
   };


    // run any preload scripts
    ORA.analyticsModule.prototype.preload = function() {
        try {
            // get the max conversion timeout from the products for click functionality
            var currTimeout = 0;
            if (ORA.analyticsModule.prototype.oraConfigObj["s_conversionTimeout"]) {
                currTimeout = ORA.analyticsModule.prototype.oraConfigObj["s_conversionTimeout"];
            }
            ORA.setLoaderConversionTimeoutDefault(Math.max(currTimeout, ORA.loaderConversionTimeoutDefault()));
            ORA.Debug.debug("PRELOAD:  Executing preload script");
            

        } catch(e) {
            ORA.abortModuleHelper("analytics", e);
        }
    };


    // load the analytics tag
    ORA.analyticsModule.prototype.load = function(callback){
        try {
            ORA.Debug.debug("LOAD:  Executing load phase");
            var productName="analytics";
            var attachId="head";
            //Load script
            
    var fail = function(){
        ORA.fireEvent(new ORA.Event(productName+"_"+ORA.Event.LOADER_MODULE_ABORT, ORA.Event.STATUS_SUCCESS));
    };
    ORA.downloadLib(attachId, callback, fail, 0, true, this.oraConfigObj.libUrl);

        } catch(e) {
            ORA.abortModuleHelper("analytics", e);
        }
    };


    ORA.analyticsModule.prototype.postload = function(){
        ORA.Debug.debug("POSTLOAD:  Executing postload analytics complete");
        try {
            ORA.Debug.info("LOADER:  ORA.analyticsModule.prototype: postload");
            //PostLoad script
            
        ORA.analytics.setup(ORA.analyticsModule.prototype.oraConfigObj);
    
        } catch(e) {
            ORA.abortModuleHelper("analytics", e);
        }
    };


    // abort gracefully on timer expire
    ORA.analyticsModule.prototype.abort = function(){
        try{
            ORA.Debug.debug("ABORT:  Executing analyticsModule abort");
            //Abort script
            

        } catch(e){
            ORA.abortModuleHelper("analytics", e);
        }
    };
    } else {
            ORA.Debug.debug('analytics  module disabled - exiting module setup');

        }


    //  setup the product Name
    ORA.analyticsModule.ProductName = "analytics";

    // register plugin
    ORA.registerPlugin(ORA.analyticsModule, "production");