var oracle = oracle || {};
oracle.truste =  {};
oracle.truste.api =  {};

(function() {
    var trusteCookieName = "notice_preferences";
    var trustarcGdprCookieName = "notice_gdpr_prefs";
    var trusteStorageItemName = "truste.eu.cookie.notice_preferences";
    var trustarcGdprStorageItemName = "truste.eu.cookie.notice_gdpr_prefs";

    this.getCookieName = function() {
      return trusteCookieName;
    };
    this.getStorageItemName = function() {
      return trusteStorageItemName;
    };
    this.getGdprCookieName = function() {
      return trustarcGdprCookieName;
    };
    this.getGdprStorageItemName = function() {
      return trustarcGdprStorageItemName;
    };
}).apply(oracle.truste);

// inject new behaviour into the api namespace
// which we defined via the truste module
(function(){
  var trusteCommon = oracle.truste;

  function getCookie(cookieKey) {
    var name = cookieKey + "=";
    var cookieArray = document.cookie.split(';');
    for(var i=0; i<cookieArray.length; i++) {
        var c = cookieArray[i];
        while (c.charAt(0)==' ')
          c = c.substring(1);
        if (c.indexOf(name) == 0)
          return c.substring(name.length, c.length);
    }
    return null;
  };

  function getLocalStorageItem(storageKey){
    //Check if local storage is supported
    if(typeof(Storage) !== "undefined") {
      // Read the value from the local storage
      return localStorage.getItem(storageKey);
    }
    return null;
  };

  function getTRUSTeLocalStorageValue(storageKey){
    var value = getLocalStorageItem(storageKey);
    if(value != null)
    {
      var obj = JSON.parse(value);
      return obj.value;
    }
    return null;
  };

  //Get Cookie value for Truste
  this.getConsentCode = function(){

    var value = getTRUSTeLocalStorageValue(trusteCommon.getStorageItemName()) ||
                  getCookie(trusteCommon.getCookieName());

    if(value == null) {
      return -1;
    } else {
      return parseInt(value) + 1;
    }

  };

  //Get Cookie value for Truste
  this.getGdprConsentCode = function(){

    var value = getTRUSTeLocalStorageValue(trusteCommon.getGdprStorageItemName()) ||
                  getCookie(trusteCommon.getGdprCookieName());

    if(value == null) {
      return -1;
    } else {
      var temp = new Array();
      temp = value.split(",");
      for (a in temp ) {
		temp[a] = parseInt(temp[a], 10) + 1;
  	  }
      return temp.toString();
    }

  };

  //Get Cookie value and Source for Truste
  this.getConsentDecision = function(){

    var value = this.getConsentCode();

    if(value == -1) {
      var text = '{"consentDecision": 0, "source": "implied"}';
      return JSON.parse(text);
    } else {
      var text = '{"consentDecision": ' +
      parseInt(value) +
      ', "source": "asserted"}';
      return JSON.parse(text);
    }

  }

  //Get Cookie value and Source for Truste
  this.getGdprConsentDecision = function(){

    var value = this.getGdprConsentCode();

    if(value == -1) {
      var text = '{"consentDecision": [0], "source": "implied"}';
      return JSON.parse(text);
    } else {
      var text = '{"consentDecision": [' +
      value +
      '], "source": "asserted"}';
      return JSON.parse(text);
    }

  }

}).apply(oracle.truste.api);
