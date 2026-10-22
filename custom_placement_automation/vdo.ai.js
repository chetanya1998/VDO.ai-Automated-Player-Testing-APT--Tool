/*16-Oct-2026 01:59:46*/
    
if(Math.random()  <= 0.0001)
  {(function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments);};
      t = l.createElement(r);
      t.async = 1;
      t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0];
      y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', 'jxi9v3zs1f');
  }

 var vdo_analyticsID = 'G-8J9SC9WB3T';
  (function(v, d, o, ai) {
      ai = d.createElement('script');
      ai.async = true;
      ai.src = o;
      d.head.appendChild(ai);
  })(
      window,
      document,
      'https://www.googletagmanager.com/gtag/js?id=' + vdo_analyticsID
  );

  function vdo_analytics() {
      window.dataLayer.push(arguments);

  }
  (function () {
    window.dataLayer = window.dataLayer || [];
    vdo_analytics("js", new Date());
  })();
  vdo_analytics('event', 'loaded', { send_to: vdo_analyticsID, event_category: 'vdoaijs', event_label: 'v-uptak-in' });

window.vdo_ai_ = window.vdo_ai_ ? window.vdo_ai_ : {};
  window.vdo_ai_.dimensions = window.vdo_ai_.dimensions || [];
  window.vdo_ai_.customDimensions = window.vdo_ai_.customDimensions || {};
  if(window.vdo_ai_.dimensions.length) {
      var items = window.vdo_ai_.dimensions;
      window.vdo_ai_.dimensions = [];
      items.forEach(customDimensions);
  }
  window.vdo_ai_.dimensions.push = customDimensions;
  function customDimensions(arr) {
      try {
        var tagname = arr[0],
          dimentionName = arr[1],
          dimentionValue = arr[2];
    
        if (dimentionName && dimentionName != '') {
          var dimensionCount = parseInt(dimentionName.replace('dim', ''));
          if (dimensionCount && dimensionCount <= 0) {
            if (!window.vdo_ai_.customDimensions[tagname]) {
              window.vdo_ai_.customDimensions[tagname] = {};
            }
            window.vdo_ai_.customDimensions[tagname][dimentionName] =
              dimentionValue;
          }
        }
      } catch (error) {
        logError(error, 'v-uptak-in');
      }
    }

function logPixel(requestObject){

  if(window.vdo_ai_.customDimensions && window.vdo_ai_.customDimensions['v-uptak-in']) {
      requestObject.dimensions = window.vdo_ai_.customDimensions['v-uptak-in'];
  }

  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://analytics.vdo.ai/logger', true);

  xhr.send(JSON.stringify(requestObject));
  xhr.onerror = () => {
      var xhrFailedRequest = new XMLHttpRequest();
      xhrFailedRequest.open('POST', 'https://analytics1.vdo.ai/logger', true);
      xhrFailedRequest.send(JSON.stringify(requestObject));
  };
}

var requestObject = {
domainName: location.hostname,
page_url:location.href,
tagName: 'v-uptak-in',
event: 'loaded',
eventData: 1,
uid: '',
dep: 'dependencies_vdodev_1154'
};

logPixel(requestObject);

function logError(e, tagname = 'v-uptak-in') {
if (typeof e === 'string') {
e = {
  message: e,
  stack: e,
};
} else {
e = {
  message: btoa(e.message).substr(0, 10),
  stack: encodeURIComponent(e.stack),
};
}vdo_analytics('event', 'Err:' + e.message, {
  send_to: vdo_analyticsID,
  event_label: tagname,
  event_category: 'VDOError',
});
var oReq = new XMLHttpRequest();
oReq.open(
'get',
'//a.vdo.ai/core/logger.php?msg=' +
  e.stack +
  '&tag=' + tagname + '&code=' +
  e.message +
  '&url=' +
  encodeURIComponent(location.href) +
  '&func=vdo.ai.js',
true
);
oReq.send();
var requestObject = {
domainName: location.hostname,
page_url: location.href,
tagName: tagname,
event: 'error',
eventData: e.message,
uid: '',
dep: 'dependencies_vdodev_1154'
};
logPixel(requestObject);
}


try {



function insideSafeFrame() {
try {
  if(top.location.href) {
    return false;
  }
} catch (error) {
  return true;
}
}


function findIframeContainingSelf() {
let selfParent = self; 
try {
    for (let i = 0; i <= 5; i++) {
      if(i == 5) {
        console.log('VDO Error : ',"nested iframes allowed upto 5."); 
      }else{ 
        if (selfParent.parent === top) return selfParent;
        else selfParent = selfParent.parent;
      }
    }
} catch (e) {
    logError(e, "v-uptak-in")
}
}

var w_vdo = (insideSafeFrame()) ? window : window.top,
d_vdo = w_vdo.document;
(function (window, document, deps, publisher) {
var protocol = window.location.protocol;

window.vdo_ai_ = window.vdo_ai_ || {};
window.vdo_ai_.cmd = window.vdo_ai_.cmd || [];


var blockUrls = ['/about-us','/privacy-policy','/terms-and-conditions'];
var requestObject1 = {
    domainName: location.hostname,
    page_url: location.href,
    tagName: 'v-uptak-in',
    event: 'player_blocked',
    eventData: 1,
    uid: ''
};
if (blockUrls.includes(window.location.pathname)) {
    logPixel(requestObject1);
    return;
}

function loadPlayerDiv(id, parentId, iframeBurst = false) {
if (!iframeBurst) {
  if (document.getElementById(id) == null) {
    var s = document.createElement("div");
    s.id = id;
  } else {
    var s = document.getElementById(id);
  }
  if (parentId != "") {
    var parentDiv = document.getElementById(parentId);
    if (!parentDiv) {
      parentDiv = document.createElement("div");
      parentDiv.id = parentId;
    }
    parentDiv.style.display = "block";
    parentDiv.style.width = "100%";
    if (parentDiv.parentNode && parentDiv.parentNode.offsetWidth < 350) {
      var margin =
        (352 - document.getElementById(parentId).parentNode.clientWidth) / 2;
      parentDiv.style.marginLeft = "-" + margin + "px";
    }
    // parentToAppend(parentDiv, s);
    window["parentToAppend" + "_vdo_ads_player_ai_7034"](parentDiv, s);
    //parentDiv.appendChild(s);
    //window.vdo_ai_v_uptak_parent = parentDiv;
    //changePlayerLocation();
    //window.addEventListener("locationchange", changePlayerLocation);
  } else {
    document.body.appendChild(s);
  }
} else {
  var parentIframes = top.document.querySelectorAll("iframe");
  for (var i = 0; i < parentIframes.length; i++) {
    var el = parentIframes[i];
    if (el.contentWindow === self) {
      // here you can create an expandable ad
      var s = document.createElement("div");
      s.style.zIndex = 111;
      s.style.margin = "0 auto";
      s.style.display = "block";
      s.style.position = "relative";
      s.width = "fit-content";
      s.id = id;
      var googleDiv = el.parentNode;

      if (parentId != "") {
        var parentDiv = document.createElement("div");
        parentDiv.id = parentId;
        parentDiv.style.display = "block";
        parentDiv.style.width = "100%";
        // parentToAppend(parentDiv, s);
       window["parentToAppend" + "_vdo_ads_player_ai_7034"](parentDiv, s);

       // window.addEventListener("locationchange", changePlayerLocation);
      } else {
        googleDiv.insertBefore(s, el);
      }

      googleDiv.style.width = "auto";
      googleDiv.parentNode.style.width = "auto";
      googleDiv.parentNode.style.height = "auto";
    }
  }
}
}


window["parentToAppend" + "_vdo_ads_player_ai_7034"] = function (newNode, childNode) {
if(newNode.id.indexOf('uptak-in-') >= 0) {
  newNode = document.createElement('div');
  newNode.id = adframeConfig.parent_div;
  document.body.appendChild(newNode);
  childNode = document.createElement("div");
  childNode.id = adframeConfig.unitId;
}
var newplace =['/topics'];
   var home =  document.querySelectorAll(`.my-10`)[1];
  var topicsGrid =  document.querySelectorAll(".grid.grid-cols-2")[0];
  var parentToAppend1 = document.querySelectorAll(".text-formatted p")[0]|| document.querySelectorAll(".my-8 .my-2")[3] || document.querySelectorAll(".my-2 .bg-gray-100")[0] || document.querySelectorAll(".col-span-2 div")[3]|| document.querySelectorAll('.my-2')[2]?.querySelectorAll('.my-1')[0];
  var parentToAppend3 = document.querySelectorAll(".my-8 .my-2")[0];
  var parentToAppend2 =document.querySelectorAll(".flex.items-center.justify-center.w-full.h-screen.bg-gray-100")[0];
  var parentToAppend = document.querySelectorAll("article .text-formatted p")[1]||document.querySelectorAll(".my-2")[3]||document.querySelectorAll(".bg-gray-100")[2]||document.querySelectorAll(".text-formatted p")[1] || document.querySelectorAll(".mb-2")[1];
  
  var result = false;
  newNode.appendChild(childNode);
  if (home) {
    result = true;
    home.insertAdjacentElement("afterend", newNode);
}
else if (window.location.pathname === "/topics" && topicsGrid) {
  result = true;

  topicsGrid.insertAdjacentElement("afterend", newNode);
} 
  else if (parentToAppend1) {
    result = true;

      parentToAppend1.insertAdjacentElement("afterend", newNode);
  }
  else if (parentToAppend) {
    result = true;

      parentToAppend.insertAdjacentElement("afterend", newNode);
  }
  else if (parentToAppend2) {
    result = true;

      parentToAppend2.insertAdjacentElement("afterend", newNode);
  } else if (parentToAppend3) {
    result = true;
     parentToAppend3.insertAdjacentElement("afterend", newNode);
  }

  window.dispatchEvent(new CustomEvent("vdo:placement", {
    detail: {success: !!result}
  }))
  }




var playerLoaded = false;
var adframeConfig = {"desktop":{"show":true,"muted":true,"width":512,"height":288,"bottomMargin":135,"topMargin":10,"unitType":"content-floating","leftOrRight":{"position":"right","margin":10},"cancelTimeoutType":{"type":"timeout","eventtype":"readyforpreroll","cancelTimeout":60000},"passback":{"allow":false,"src":null,"string":"","timeout":15000,"type":"timeout","value":15000},"smallWidth":333,"smallHeight":187,"crossSize":17,"dispose_off":false,"bannerOff":true,"companionOff":false,"float_only_on_ads":false,"top_floating":true,"taboola_overlap_exception":false,"amzn_nlb_banner":true,"ticker_show":true,"autoResize":false},"mobile":{"dispose_off":false,"show":true,"muted":true,"width":344,"height":258,"bottomMargin":135,"topMargin":0,"unitType":"content-floating","leftOrRight":{"position":"right","margin":10},"cancelTimeoutType":{"type":"timeout","eventtype":"readyforpreroll","cancelTimeout":60000},"passback":{"allow":false,"type":"timeout","value":15000,"src":null,"string":"","timeout":15000},"smallWidth":256,"smallHeight":144,"crossSize":24,"bannerOff":true,"companionOff":false,"float_only_on_ads":false,"top_floating":true,"taboola_overlap_exception":false,"amzn_nlb_banner":true,"mobile_floater_background":"#ffffff","ticker_show":true,"autoResize":false},"bottomMargin":10,"cancelTimeout":10000,"id":"vdo_ai_2439","muted":true,"playsinline":true,"autoplay":true,"preload":true,"video_clickthrough_url":"","pubId":"3196","brandLogo":{"img":"","url":""},"coppa":false,"add_on_page_ready":"no","showLogo":false,"parent_div":"v-uptak-in","adbreak_offsets":[0,5,10,15,20,25],"show_on_ad":false,"autoReplay":true,"close_after_first_ad_timer":0,"canAutoplayCheck":true,"unfilled_auction_timer":"default","audiojk":100,"dual_player":false,"amzn_dual_player":false,"btfc":false,"skip_ads":false,"dynamic_thumbnail":true,"cfvt":false,"unmute_on_interaction":true,"showOnlyOnAd":false,"disposeOnSkip":false,"autoplay_player":true,"float_after_cross_click":true,"playAdsOnly":false,"unitStyle":"single","dfp_companion":true,"vast_copy":true,"amplify_banner_tag":"","amplify_display_time":0,"playlist_url":"","playlistType":"local","ga_event":true,"use_global_hls":false,"domain":"uptak.in","path":"a.vdo.ai\/core\/v-uptak-in\/adframe.js","unitId":"_vdo_ads_player_ai_7034","tag_type":"other","tag_exclusion":{"exclude_mcm":false,"exclude_mcm_apac":false},"tag":"v-uptak-in","timestamp":1792141181,"b_domain":false,"agent":false,"playlist_id":1306,"realParentDiv":"v-uptak-in","static_vpmute":true,"svpm_excluded_partners":null,"wid":5176,"unit_id":7034,"allowed_dims":0,"dependency":"dependencies_vdodev_1154","pubId_vdo":"1975_3150","pubId_atlas":"1975_3150","pubId_wc":"3196","pubId_jj":"","pubId_adsolut":"","pubId_hs":"","showOnlyFirst":false,"media_url":"https:\/\/h5.vdo.ai\/media_file\/v-uptak-in\/source\/","content_sources":[{"video":"uploads\/videos\/1782803539726a436c5348613","img":"uploads\/thumbnails\/1782803539726a436c5348613.png","duration":248,"title":"uptak%20v2%2029%20june%2026","keyword":""},{"video":"uploads\/videos\/1782803514726a436c3a515bb","img":"uploads\/thumbnails\/1782803514726a436c3a515bb.png","duration":287,"title":"uptak%20v1%2029%20june%2026","keyword":""}],"show_on":"ads-ad-started","tagType":"video","category":"news","google_mcm":"22664902737","google_mcm_apac":"22664902737","ticker":[{"title":"\u092e\u0941\u0938\u094d\u0915\u093e\u0928 \u0915\u0940 \u092c\u0947\u091f\u0940 6 \u0938\u093e\u0932 \u0915\u0940 \u0939\u094b\u0917\u0940, \u0924\u092d\u0940 \u0926\u0940 \u091c\u093e\u090f\u0917\u0940 \u092b\u093e\u0902\u0938\u0940? \u0921\u0940\u091c\u0940\u0938\u0940 \u0915\u094d\u0930\u093f\u092e\u093f\u0928\u0932 \u0915\u0947\u0915\u0947 \u091a\u094c\u092c\u0947 \u0928\u0947 \u0938\u092e\u091d\u093e\u092f\u093e \u092a\u0942\u0930\u093e \u0915\u093e\u0928\u0942\u0928","link":"https:\/\/www.uptak.in\/neighbouring-news\/meerut\/story\/will-the-execution-by-hanging-take-place-only-when-muskan-s-daughter-turns-6-dgc-criminal-kk-chaubey-explains-the-law-in-detail-3553896-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u091d\u094b\u092a\u0921\u093c\u0940 \u092e\u0947\u0902 \u092c\u093e\u0938\u0940 \u0930\u094b\u091f\u0940 \u0916\u093e\u0915\u0930 \u0905\u0915\u0947\u0932\u0947 \u0930\u0939 \u0930\u0939\u0940 \u092c\u0941\u091c\u0941\u0930\u094d\u0917 \u092e\u0939\u093f\u0932\u093e \u0915\u0947 \u092a\u093e\u0938 \u092a\u0939\u0941\u0902\u091a\u0947 ACP \u0907\u092e\u0930\u093e\u0928 \u0905\u0939\u092e\u0926 \u0928\u0947 \u0915\u0940 \u0910\u0938\u0940 \u092e\u0926\u0926","link":"https:\/\/www.uptak.in\/neighbouring-news\/agra\/story\/acp-imran-ahmed-reached-out-to-an-elderly-woman-living-alone-in-a-hut-eating-stale-bread-3553893-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"UP Startup Policy 2026: \u092b\u0902\u0921\u093f\u0902\u0917, \u091f\u094d\u0930\u0947\u0928\u093f\u0902\u0917 \u0914\u0930 \u092c\u093e\u091c\u093e\u0930 \u0924\u0915 \u092a\u0939\u0941\u0902\u091a, \u091c\u093e\u0928\u093f\u090f \u0928\u0908 \u0928\u0940\u0924\u093f \u0915\u0940 \u0916\u093e\u0938 \u092c\u093e\u0924\u0947\u0902","link":"https:\/\/www.uptak.in\/apna-up\/story\/up-startup-policy-2026-funding-training-and-market-access-key-highlights-of-the-new-policy-3553889-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u092e\u0947\u0930\u0920 \u092e\u0947\u0902 \u092d\u093e\u091c\u092a\u093e \u0914\u0930 \u0938\u092a\u093e \u092e\u0947\u0902 \u0915\u093f\u0928 \u092a\u094d\u0930\u0924\u094d\u092f\u093e\u0936\u093f\u092f\u094b\u0902 \u0915\u0940 \u0938\u0940\u091f\u0947\u0902 \u092a\u0942\u0930\u0940 \u0915\u0940 \u092a\u0942\u0930\u0940 \u092b\u0902\u0938\u0940 \u0939\u0948\u0902?","link":"https:\/\/www.uptak.in\/neighbouring-news\/meerut\/story\/which-candidates-in-bjp-and-sp-have-their-seats-completely-stuck-in-meerut-3553883-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"Opinion: &apos;\u0927\u0928 \u0915\u0947 \u0928\u093f\u092e\u093f\u0924\u094d\u0924 \u0927\u0930\u094d\u092e \u0928\u0939\u0940\u0902 \u091b\u094b\u0921\u093c\u0942\u0902\u0917\u093e&apos;... \u0938\u0940\u090f\u092e \u092f\u094b\u0917\u0940 \u0915\u0947 \u0907\u0938 \u0938\u0902\u0915\u0932\u094d\u092a \u0915\u0947 \u0938\u093f\u092f\u093e\u0938\u0940 \u0914\u0930 \u0938\u093e\u0902\u0938\u094d\u0915\u0943\u0924\u093f\u0915 \u092e\u093e\u092f\u0928\u0947","link":"https:\/\/www.uptak.in\/opinion\/story\/opinion-i-will-not-abandon-my-principles-for-the-sake-of-wealth-the-political-and-cultural-implications-of-cm-yogi-s-resolve-3553873-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u092e\u0941\u0916\u094d\u092f\u092e\u0902\u0924\u094d\u0930\u0940 \u092f\u094b\u0917\u0940 \u0906\u0926\u093f\u0924\u094d\u092f\u0928\u093e\u0925 \u0928\u0947 \u0935\u093e\u0930\u093e\u0923\u0938\u0940 \u092e\u0947\u0902 \u0915\u093f\u092f\u093e \u0938\u094d\u0935\u091a\u094d\u091b\u0924\u093e \u092e\u093f\u0924\u094d\u0930\u094b\u0902 \u0915\u093e \u0938\u092e\u094d\u092e\u093e\u0928","link":"https:\/\/www.uptak.in\/apna-up\/story\/chief-minister-yogi-adityanath-honored-cleanliness-friends-in-varanasi-3553871-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u092f\u094b\u0917\u0940 \u0938\u0930\u0915\u093e\u0930 \u0915\u0947 \u0932\u0917\u093e\u0924\u093e\u0930 \u092a\u094d\u0930\u092f\u093e\u0938 \u0938\u0947 9 \u0932\u093e\u0916 \u0938\u0947 \u0905\u0927\u093f\u0915 \u0930\u0942\u092b\u091f\u0949\u092a \u0938\u094b\u0932\u0930 \u092a\u094d\u0932\u093e\u0902\u091f \u0938\u094d\u0925\u093e\u092a\u093f\u0924","link":"https:\/\/www.uptak.in\/apna-up\/story\/due-to-the-continuous-efforts-of-the-yogi-government-more-than-9-lakh-rooftop-solar-plants-have-been-installed-3553868-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u0928\u0935\u0930\u093e\u0924\u094d\u0930\u093f \u0915\u0947 \u092c\u0940\u091a \u0938\u092a\u093e \u0928\u0947\u0924\u093e\u0913\u0902 \u092a\u0930 \u091a\u093f\u0915\u0928 \u092a\u093e\u0930\u094d\u091f\u0940 \u0915\u0930\u0928\u0947 \u0915\u093e \u0906\u0930\u094b\u092a, \u0926\u093e\u0935\u0924 \u092e\u0947\u0902 \u092a\u0939\u0941\u0902\u091a\u0947 \u0925\u0947 \u0930\u093e\u092e\u091c\u0940\u0932\u093e\u0932 \u0938\u0941\u092e\u0928?","link":"https:\/\/www.uptak.in\/politics\/story\/sp-leaders-accused-of-hosting-chicken-party-during-navratri-did-ramjilal-suman-attend-the-feast-3553867-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u0905\u0916\u093f\u0932\u0947\u0936 \u092f\u093e\u0926\u0935 \u0928\u0947 \u0915\u0941\u0902\u0921\u093e \u092e\u0947\u0902 \u0915\u093f\u092f\u093e \u092c\u0921\u093c\u093e \u0917\u0947\u092e, \u0938\u092a\u093e \u092e\u0947\u0902 \u0906\u090f \u092f\u0947 \u0926\u093f\u0917\u094d\u0917\u091c \u0928\u0947\u0924\u093e, \u0930\u093e\u091c\u093e \u092d\u0948\u092f\u093e \u0915\u0940 \u092c\u0922\u093c\u0940 \u092e\u0941\u0936\u094d\u0915\u093f\u0932\u0947\u0902!","link":"https:\/\/www.uptak.in\/apna-up\/story\/akhilesh-yadav-makes-a-major-move-in-kunda-raja-bhaiya-s-stronghold-by-bringing-over-this-prominent-leader-3553863-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u092e\u0948\u0902 \u092a\u0942\u0930\u0940 \u0924\u0930\u0939 \u0924\u0948\u092f\u093e\u0930 \u0939\u0942\u0902... \u092e\u0947\u0930\u0920 \u0915\u0940 \u092e\u0941\u0938\u094d\u0915\u093e\u0928 \u0914\u0930 \u0938\u093e\u0939\u093f\u0932 \u0915\u094b \u092b\u093e\u0902\u0938\u0940 \u0915\u0940 \u0938\u091c\u093e \u092e\u093f\u0932\u0924\u0947 \u0939\u0940 \u092a\u0935\u0928 \u091c\u0932\u094d\u0932\u093e\u0926 \u0928\u0947 \u0915\u0939 \u0926\u0940 \u092c\u0921\u093c\u0940 \u092c\u093e\u0924","link":"https:\/\/www.uptak.in\/neighbouring-news\/meerut\/story\/i-am-fully-prepared-pawan-jallad-said-a-big-thing-as-soon-as-meerut-muskan-and-sahil-were-sentenced-to-death-3553848-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u092a\u094d\u0930\u092f\u093e\u0917\u0930\u093e\u091c \u092e\u0947\u0902 \u0935\u0915\u0940\u0932 \u0938\u0924\u0940\u0936 \u091a\u0902\u0926\u094d\u0930 \u0936\u094d\u0930\u0940\u0935\u093e\u0938\u094d\u0924\u0935 \u0915\u0940 \u0917\u094b\u0932\u0940 \u092e\u093e\u0930\u0915\u0930 \u0939\u0924\u094d\u092f\u093e, \u091c\u092e\u0940\u0928 \u0935\u093f\u0935\u093e\u0926 \u0915\u094b \u0932\u0947\u0915\u0930 \u0939\u0941\u0908 \u092f\u0947 \u0935\u093e\u0930\u0926\u093e\u0924","link":"https:\/\/www.uptak.in\/neighbouring-news\/prayagraj\/story\/lawyer-satish-chandra-srivastava-was-shot-dead-in-prayagraj-over-a-land-dispute-3553843-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u092c\u0940\u091c\u0947\u092a\u0940 \u091b\u094b\u0921\u093c \u0905\u0916\u093f\u0932\u0947\u0936 \u092f\u093e\u0926\u0935 \u0915\u0947 \u0938\u093e\u0925 \u0906\u090f \u092c\u0943\u091c\u092d\u0942\u0937\u0923 \u0936\u0930\u0923 \u0938\u093f\u0902\u0939 \u0915\u0947 \u0915\u0930\u0940\u092c\u0940 \u092d\u0935\u093e\u0928\u0940 \u092d\u0940\u0916 \u0936\u0941\u0915\u094d\u0932\u093e \u0915\u094c\u0928 \u0939\u0948\u0902?","link":"https:\/\/www.uptak.in\/politics\/story\/who-is-bhawani-bhik-shukla-a-close-associate-of-brijbhushan-sharan-singh-who-left-the-bjp-and-joined-akhilesh-yadav-3553833-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"},{"title":"\u092e\u0947\u0930\u0920 \u0915\u094b\u0930\u094d\u091f \u092e\u0947\u0902 \u092b\u093e\u0902\u0938\u0940 \u0915\u0940 \u0938\u091c\u093e \u0938\u0941\u0928\u0924\u0947 \u0939\u0940 \u092e\u0941\u0938\u094d\u0915\u093e\u0928 \u0914\u0930 \u0938\u093e\u0939\u093f\u0932 \u0928\u0947 \u090f\u0915 \u0926\u0942\u0938\u0930\u0947 \u0915\u094b \u0926\u0947\u0916 \u0915\u094d\u092f\u093e \u0915\u093f\u092f\u093e?","link":"https:\/\/www.uptak.in\/neighbouring-news\/meerut\/story\/what-did-muskaan-and-sahil-do-when-they-saw-each-other-after-hearing-the-death-sentence-in-meerut-court-3553830-2026-10-16?utm_source=uptak_website&utm_medium=story&utm_campaign=vdo_referrer"}],"bidders":{"0":{"bids":[{"bidder":"adagio","params":{"organizationId":"1442","site":"uptak-in","placement":"uptak.in","adUnitElementId":"vdo_video_placement"}},{"bidder":"amazon","params":{"placementId":"uptak.in","floor":0}},{"bidder":"kueezrtb","params":{"pId":"65lk7c192882r0011813fn9","cId":"682c852e348fc3d970f3a434"}},{"bidder":"nextMillennium","params":{"group_id":"1472"}},{"bidder":"onetag","params":{"pubId":"62e564782c44a66"}},{"bidder":"richaudience","params":{"pid":"MP_1fsNorHWpU","supplyType":"site"}},{"bidder":"rise","params":{"org":"670135d2e64cee0001b3f010"}},{"bidder":"rubicon","params":{"accountId":27408,"siteId":593356,"zoneId":3790996,"video":{"language":"en"}}}],"banner":{"prebid":[{"bidder":"oftmedia","params":{"placement_id":38015477}}]}},"5":{"bids":[{"bidder":"adagio","params":{"organizationId":"1442","site":"uptak-in","placement":"uptak.in","adUnitElementId":"vdo_video_placement"}},{"bidder":"amazon","params":{"placementId":"uptak.in","floor":0}},{"bidder":"kueezrtb","params":{"pId":"65lk7c192882r0011813fn9","cId":"682c852e348fc3d970f3a434"}},{"bidder":"nextMillennium","params":{"group_id":"1472"}},{"bidder":"onetag","params":{"pubId":"62e564782c44a66"}},{"bidder":"richaudience","params":{"pid":"MP_1fsNorHWpU","supplyType":"site"}},{"bidder":"rise","params":{"org":"670135d2e64cee0001b3f010"}},{"bidder":"rubicon","params":{"accountId":27408,"siteId":593356,"zoneId":3790996,"video":{"language":"en"}}}],"banner":{"prebid":[{"bidder":"oftmedia","params":{"placement_id":38015477}}]}},"10":{"bids":[{"bidder":"adagio","params":{"organizationId":"1442","site":"uptak-in","placement":"uptak.in","adUnitElementId":"vdo_video_placement"}},{"bidder":"amazon","params":{"placementId":"uptak.in","floor":0}},{"bidder":"kueezrtb","params":{"pId":"65lk7c192882r0011813fn9","cId":"682c852e348fc3d970f3a434"}},{"bidder":"nextMillennium","params":{"group_id":"1472"}},{"bidder":"onetag","params":{"pubId":"62e564782c44a66"}},{"bidder":"richaudience","params":{"pid":"MP_1fsNorHWpU","supplyType":"site"}},{"bidder":"rise","params":{"org":"670135d2e64cee0001b3f010"}},{"bidder":"rubicon","params":{"accountId":27408,"siteId":593356,"zoneId":3790996,"video":{"language":"en"}}}],"banner":{"prebid":[{"bidder":"oftmedia","params":{"placement_id":38015477}}]}},"15":{"bids":[{"bidder":"adagio","params":{"organizationId":"1442","site":"uptak-in","placement":"uptak.in","adUnitElementId":"vdo_video_placement"}},{"bidder":"amazon","params":{"placementId":"uptak.in","floor":0}},{"bidder":"kueezrtb","params":{"pId":"65lk7c192882r0011813fn9","cId":"682c852e348fc3d970f3a434"}},{"bidder":"nextMillennium","params":{"group_id":"1472"}},{"bidder":"richaudience","params":{"pid":"MP_1fsNorHWpU","supplyType":"site"}},{"bidder":"rise","params":{"org":"670135d2e64cee0001b3f010"}},{"bidder":"rubicon","params":{"accountId":27408,"siteId":593356,"zoneId":3790996,"video":{"language":"en"}}}],"banner":{"prebid":[{"bidder":"oftmedia","params":{"placement_id":38015477}}]}},"20":{"bids":[{"bidder":"adagio","params":{"organizationId":"1442","site":"uptak-in","placement":"uptak.in","adUnitElementId":"vdo_video_placement"}},{"bidder":"amazon","params":{"placementId":"uptak.in","floor":0}},{"bidder":"kueezrtb","params":{"pId":"65lk7c192882r0011813fn9","cId":"682c852e348fc3d970f3a434"}},{"bidder":"nextMillennium","params":{"group_id":"1472"}},{"bidder":"richaudience","params":{"pid":"MP_1fsNorHWpU","supplyType":"site"}},{"bidder":"rise","params":{"org":"670135d2e64cee0001b3f010"}},{"bidder":"rubicon","params":{"accountId":27408,"siteId":593356,"zoneId":3790996,"video":{"language":"en"}}}],"banner":{"prebid":[{"bidder":"oftmedia","params":{"placement_id":38015477}}]}},"25":{"bids":[{"bidder":"adagio","params":{"organizationId":"1442","site":"uptak-in","placement":"uptak.in","adUnitElementId":"vdo_video_placement"}},{"bidder":"amazon","params":{"placementId":"uptak.in","floor":0}},{"bidder":"kueezrtb","params":{"pId":"65lk7c192882r0011813fn9","cId":"682c852e348fc3d970f3a434"}},{"bidder":"nextMillennium","params":{"group_id":"1472"}},{"bidder":"richaudience","params":{"pid":"MP_1fsNorHWpU","supplyType":"site"}},{"bidder":"rise","params":{"org":"670135d2e64cee0001b3f010"}},{"bidder":"rubicon","params":{"accountId":27408,"siteId":593356,"zoneId":3790996,"video":{"language":"en"}}}],"banner":{"prebid":[{"bidder":"oftmedia","params":{"placement_id":38015477}}]}}},"targeting":[],"ibv_linked_tag":"","adx":[],"s2s":false,"overflow_size":false,"handle_url_change":true,"style":"vdo[id^=\"v-uptak-in\"] .ima-ad-container,\nvdo[id^=\"v-uptak-in\"] .ima-ad-container > div,\nvdo[id^=\"v-uptak-in\"] .ima-ad-container .ima-seek-bar-div {\n  width: 100% !important;\n}\nvdo[id^=\"v-uptak-in\"] .vjs-volume-bar.vjs-slider,\nvdo[id^=\"v-uptak-in\"] .vjs-volume-level {\n  width: 0.3em !important;\n}\nvdo[id^=\"v-uptak-in\"] .vjs-volume-control {\n  width: 3em !important;\n}\nvdo[id^=\"v-uptak-in\"] .vjs-volume-panel.vjs-control.vjs-volume-panel-vertical {\n  width: 4em !important;\n}\nvdo[id*=\"v-uptak-in\"] vdo[id*=\"vdoai_ad_container_vdo_ai_\"] {\n  width: 100% !important;\n}\n.vdoai_parentDiv {\n  z-index: 1 !important;\n}\n.header_headers__5ZiTt {\n  z-index: 2;\n}\n","ver":"v6.9.0","vast":{"0":[{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/26001828,22664902737\/vdoai-dfp-parent-adunit\/z1_dfp_v_uptak_in_v_pre_2&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm","floor":null,"position":100},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/22100121508,22664902737\/DFP_APAC_Parent_First_AdBreak\/ellipsis_dfp_v_uptak_in_v_pre_2&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm_apac","floor":null,"position":99},{"ad_url":"ad.vidverto.io\/delivery\/video\/zona\/18739?video=vast&pzoneid=18739&ifa=&top_url=https%3A%2F%2Fwww.uptak.in%2F","partner":"Vidverto","floor":0,"position":300},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/339474670,23330009029\/VDOai\/uptak&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&sz=300x250%7C320x180%7C360x640%7C400x300%7C640x360%7C640x480%7C1024x768%7C1280x720&gdfp_req=1&unviewed_position_start=1&output=vast&env=vp&impl=s&correlator=&vad_type=linear&url=uptak.in","partner":"Adnimation","floor":0,"position":299},{"ad_url":"pubads.g.doubleclick.net\/gampad\/live\/ads?iu=\/7047,22691085319\/apl\/videoapl2\/vdoapl\/uptak.in&description_url=uptak.in&tfcd=0&npa=0&sz=400x300%7C640x480&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=","partner":"adipolo","floor":2,"position":297},{"ad_url":"optimized-by.rubiconproject.com\/a\/api\/vast.xml?account_id=27408&site_id=633333&zone_id=4096209&size_id=201&height=640&width=480&tg_c.language=en&rf=https:\/\/uptak.in\/&p_aso.video.plcmt=1","partner":"rubicon","floor":1,"position":0}],"5":[{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/26001828,22664902737\/DFP_Z1_Parent_Second_AdBreak\/z1_dfp_v_uptak_in_v_mid1_2&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm","floor":null,"position":100},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/22100121508,22664902737\/DFP_APAC_Parent_Second_AdBreak\/ellipsis_dfp_v_uptak_in_v_mid1_2&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm_apac","floor":null,"position":99},{"ad_url":"ad.vidverto.io\/delivery\/video\/zona\/18739?video=vast&pzoneid=18739&ifa=&top_url=https%3A%2F%2Fwww.uptak.in%2F","partner":"Vidverto","floor":0,"position":300},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/339474670,23330009029\/VDOai\/uptak&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&sz=300x250%7C320x180%7C360x640%7C400x300%7C640x360%7C640x480%7C1024x768%7C1280x720&gdfp_req=1&unviewed_position_start=1&output=vast&env=vp&impl=s&correlator=&vad_type=linear&url=uptak.in","partner":"Adnimation","floor":0,"position":299},{"ad_url":"pubads.g.doubleclick.net\/gampad\/live\/ads?iu=\/7047,22691085319\/apl\/videoapl2\/vdoapl\/uptak.in&description_url=uptak.in&tfcd=0&npa=0&sz=400x300%7C640x480&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=","partner":"adipolo","floor":2,"position":297},{"ad_url":"optimized-by.rubiconproject.com\/a\/api\/vast.xml?account_id=27408&site_id=633333&zone_id=4096209&size_id=201&height=640&width=480&tg_c.language=en&rf=https:\/\/uptak.in\/&p_aso.video.plcmt=1","partner":"rubicon","floor":1,"position":0}],"10":[{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/26001828,22664902737\/DFP_Z1_Parent_third_AdBreak\/z1_dfp_v_uptak_in_v_mid2_2&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm","floor":null,"position":100},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/22100121508,22664902737\/DFP_APAC_Parent_third_AdBreak\/ellipsis_dfp_v_uptak_in_v_mid2_2&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm_apac","floor":null,"position":99},{"ad_url":"ad.vidverto.io\/delivery\/video\/zona\/18739?video=vast&pzoneid=18739&ifa=&top_url=https%3A%2F%2Fwww.uptak.in%2F","partner":"Vidverto","floor":0,"position":300},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/339474670,23330009029\/VDOai\/uptak&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&sz=300x250%7C320x180%7C360x640%7C400x300%7C640x360%7C640x480%7C1024x768%7C1280x720&gdfp_req=1&unviewed_position_start=1&output=vast&env=vp&impl=s&correlator=&vad_type=linear&url=uptak.in","partner":"Adnimation","floor":0,"position":299},{"ad_url":"pubads.g.doubleclick.net\/gampad\/live\/ads?iu=\/7047,22691085319\/apl\/videoapl2\/vdoapl\/uptak.in&description_url=uptak.in&tfcd=0&npa=0&sz=400x300%7C640x480&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=","partner":"adipolo","floor":2,"position":297},{"ad_url":"optimized-by.rubiconproject.com\/a\/api\/vast.xml?account_id=27408&site_id=633333&zone_id=4096209&size_id=201&height=640&width=480&tg_c.language=en&rf=https:\/\/uptak.in\/&p_aso.video.plcmt=1","partner":"rubicon","floor":1,"position":0}],"15":[{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/26001828,22664902737\/DFP_Z1_Parent_Fourth_AdBreak\/z1_dfp_v_uptak_in_v_mid3_2&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm","floor":null,"position":100},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/22100121508,22664902737\/DFP_APAC_Parent_Fourth_AdBreak\/ellipsis_dfp_v_uptak_in_v_mid3_2&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm_apac","floor":null,"position":99},{"ad_url":"ad.vidverto.io\/delivery\/video\/zona\/18739?video=vast&pzoneid=18739&ifa=&top_url=https%3A%2F%2Fwww.uptak.in%2F","partner":"Vidverto","floor":0,"position":300},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/339474670,23330009029\/VDOai\/uptak&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&sz=300x250%7C320x180%7C360x640%7C400x300%7C640x360%7C640x480%7C1024x768%7C1280x720&gdfp_req=1&unviewed_position_start=1&output=vast&env=vp&impl=s&correlator=&vad_type=linear&url=uptak.in","partner":"Adnimation","floor":0,"position":299},{"ad_url":"pubads.g.doubleclick.net\/gampad\/live\/ads?iu=\/7047,22691085319\/apl\/videoapl1\/vdoapl\/uptak.in&description_url=uptak.in&tfcd=0&npa=0&sz=400x300%7C640x480&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=","partner":"adipolo","floor":1,"position":297},{"ad_url":"optimized-by.rubiconproject.com\/a\/api\/vast.xml?account_id=27408&site_id=633333&zone_id=4096209&size_id=201&height=640&width=480&tg_c.language=en&rf=https:\/\/uptak.in\/&p_aso.video.plcmt=1","partner":"rubicon","floor":1,"position":0}],"20":[{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/26001828,22664902737\/DFP_Z1_Parent_Fifth_AdBreak\/z1_dfp_v_uptak_in_v_mid4_3&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm","floor":null,"position":100},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/22100121508,22664902737\/DFP_APAC_Parent_Fifth_AdBreak\/ellipsis_dfp_v_uptak_in_v_mid4_3&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm_apac","floor":null,"position":99},{"ad_url":"ad.vidverto.io\/delivery\/video\/zona\/18739?video=vast&pzoneid=18739&ifa=&top_url=https%3A%2F%2Fwww.uptak.in%2F","partner":"Vidverto","floor":0,"position":300},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/339474670,23330009029\/VDOai\/uptak&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&sz=300x250%7C320x180%7C360x640%7C400x300%7C640x360%7C640x480%7C1024x768%7C1280x720&gdfp_req=1&unviewed_position_start=1&output=vast&env=vp&impl=s&correlator=&vad_type=linear&url=uptak.in","partner":"Adnimation","floor":0,"position":299},{"ad_url":"pubads.g.doubleclick.net\/gampad\/live\/ads?iu=\/7047,22691085319\/apl\/videoapl1\/vdoapl\/uptak.in&description_url=uptak.in&tfcd=0&npa=0&sz=400x300%7C640x480&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=","partner":"adipolo","floor":1,"position":297},{"ad_url":"optimized-by.rubiconproject.com\/a\/api\/vast.xml?account_id=27408&site_id=633333&zone_id=4096209&size_id=201&height=640&width=480&tg_c.language=en&rf=https:\/\/uptak.in\/&p_aso.video.plcmt=1","partner":"rubicon","floor":1,"position":0}],"25":[{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/26001828,22664902737\/DFP_Z1_Parent_Sixth_AdBreak\/z1_dfp_v_uptak_in_v_mid4_4&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm","floor":null,"position":100},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/22100121508,22664902737\/DFP_APAC_Parent_Sixth_AdBreak\/ellipsis_dfp_v_uptak_in_v_mid4_4&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=&vpos=preroll&sz=288x162%7C300x250%7C400x300%7C419x236%7C640x360%7C640x480%7C1x1","partner":"google_mcm_apac","floor":null,"position":99},{"ad_url":"ad.vidverto.io\/delivery\/video\/zona\/18739?video=vast&pzoneid=18739&ifa=&top_url=https%3A%2F%2Fwww.uptak.in%2F","partner":"Vidverto","floor":0,"position":300},{"ad_url":"pubads.g.doubleclick.net\/gampad\/ads?iu=\/339474670,23330009029\/VDOai\/uptak&description_url=http%3A%2F%2Fuptak.in&tfcd=0&npa=0&sz=300x250%7C320x180%7C360x640%7C400x300%7C640x360%7C640x480%7C1024x768%7C1280x720&gdfp_req=1&unviewed_position_start=1&output=vast&env=vp&impl=s&correlator=&vad_type=linear&url=uptak.in","partner":"Adnimation","floor":0,"position":299},{"ad_url":"pubads.g.doubleclick.net\/gampad\/live\/ads?iu=\/7047,22691085319\/apl\/videoapl1\/vdoapl\/uptak.in&description_url=uptak.in&tfcd=0&npa=0&sz=400x300%7C640x480&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=","partner":"adipolo","floor":1,"position":297},{"ad_url":"optimized-by.rubiconproject.com\/a\/api\/vast.xml?account_id=27408&site_id=633333&zone_id=4096209&size_id=201&height=640&width=480&tg_c.language=en&rf=https:\/\/uptak.in\/&p_aso.video.plcmt=1","partner":"rubicon","floor":1,"position":0}]},"companionBanner":{"google_mcm":{"placement":"\/26001828,22664902737\/Z1_Companion_Banner\/z1_dfp_v_uptak_in_companion_b_pre_1","upr":""},"google_mcm_apac":{"placement":"","upr":""},"gtr":{"include":["RO","GB","CA","DE","US","AE","AU"]},"rgtr":[{"geos":["RO","GB","CA","DE","US","AE","AU"],"time":30}]},"nonLinearBanner":{"google_mcm":{"placement":"","upr":""},"google_mcm_apac":{"placement":"","upr":""},"gtr":{"include":["BE","BG","BR","RO","JP","GB","HU","PT","PL","ZA","SA","ES","FR","FI","NL","NO","NZ","CH","CA","SK","KR","SE","DK","DE","US","AE","IS","AU","AT","IE"]}}};

var checkTimer;

adframeConfig.vdo_ai_initial_time = Date.now();

function callAdframe() {
  if(!playerLoaded) {
      playerLoaded = true;
      clearInterval(checkTimer);
      window.vdo_ai_.cmd.push(function() {
        window.initVdo(adframeConfig);
      });

  }
}


function loadScriptSync(src, id) {
  return new Promise(function(resolve, reject) {

      if(src.indexOf('ima3.js') > 0 && document.querySelector('script[src*="imasdk.googleapis.com/js/sdkloader/ima3.js"]')) {
        if(window.google && window.google.ima) {

          resolve();
          return false;
        } else {
          document.querySelector('script[src*="imasdk.googleapis.com/js/sdkloader/ima3.js"]').addEventListener('load', resolve);
          return false;
        }
      }
      var s = document.createElement("script");
      s.id = id;
      var existingScript = document.getElementById(id);

      s.async = true;
      s.src = protocol + src;
      document.body.appendChild(s);
      var timestamp = Date.now();

      s.onload = function(e) {
        
        vdo_analytics('event', 'timing_complete', {
          name: 'load_' + (src.indexOf('vdo.min.js') >= 0 ? 'vdo.min.js' : 'ima3.js'),
          value: Date.now() - timestamp,
          event_category: 'video',
          send_to: vdo_analyticsID,
          event_label: "v-uptak-in",
        });

        resolve();
      };

    s.onerror = function (e) {
      if (src.includes("ima3.js")) {
        var blockedImaObject = {
          domainName: location.hostname,
          page_url: location.href,
          tagName: "v-uptak-in",
          event: "blocked_ima",
          eventData: 1,
          dep: "dependencies_vdodev_1154"
        };
        logPixel(blockedImaObject);
          vdo_analytics("event", "blocked_ima", {
  send_to: vdo_analyticsID,
  event_category: "vdoaijs",
  event_label: "v-uptak-in",
  page_location: location.href,
  page_title: document.title,
});
      }
      resolve();
    };
    
    })
}

function inIframe(){try{return self!==top}catch(r){return!0}}var iframe_Burst=inIframe() ? insideSafeFrame() ? false : true : false;



//#region full_dependencies testing
function startTag(version){

  loadPlayerDiv('_vdo_ads_player_ai_7034','v-uptak-in',iframe_Burst);
  changeParentDivId();

callAdframe();

}


function changeParentDivId(){
  window.vdo_ai_ = window.vdo_ai_ || {};
  window.vdo_ai_.ads = window.vdo_ai_.ads || {};
  window.vdo_ai_.ads[adframeConfig.unitId]  = window.vdo_ai_.ads[adframeConfig.unitId] || {}
  window.vdo_ai_.ads[adframeConfig.unitId].amazonHasAd = false;
  window.vdo_ai_.ids = window.vdo_ai_.ids || [];
  var parent = document.getElementById(adframeConfig.parent_div);
  adframeConfig.parent_div = adframeConfig.parent_div+"-"+window.vdo_ai_.ids.length;
  parent.id = adframeConfig.parent_div;
  window.vdo_ai_.ids.push({
    parentId: adframeConfig.parent_div,
  })
}



    function getHourInTimeZone(timeZone) {
    const now = new Date();
    const options = {
      hour: "2-digit",
      hour12: false, // Use 24-hour format
      timeZone: timeZone,
    };

    const timeFormatter = new Intl.DateTimeFormat("en-US", options);
    const timeString = timeFormatter.format(now);
    return timeString; // Returns the hour as a string (e.g., "14" for 2 PM)
  }
  
  const IST = "Asia/Kolkata";
  const PST = "America/Los_Angeles";
  const IST_TIMESTAMP = getHourInTimeZone(IST);
  const PST_TIMESTAMP = getHourInTimeZone(PST);

  var sessionStorageKey = `vdo-ai-${adframeConfig.tag}-${adframeConfig.timestamp}-${IST_TIMESTAMP}-${PST_TIMESTAMP}`;

  function onConfigLoaded(response) {
      return new Promise(function (resolve, reject) {
      if (response.agent == "false") {
          adframeConfig = Object.assign(adframeConfig, response);
          if (typeof custom_placement_id !== "undefined") {
          var feedReq = new XMLHttpRequest();
          feedReq.onerror = function () {
              resolve(adframeConfig.ver);
          };
          feedReq.onload = function () {
              try {
              var feedResponse = JSON.parse(this.response);
              console.log(feedResponse);
              adframeConfig = Object.assign(adframeConfig, feedResponse);
              } catch (r) { }
              resolve(adframeConfig.ver);
          }.bind(feedReq);
          feedReq.open(
              "get",
              "//a.vdo.ai/core/v-uptak-in/dynamic_feed?playlist_id=" +
              custom_placement_id,
              true
          );
          feedReq.send();
          } else {
          resolve(adframeConfig.ver);
          }
      } else {
          var requestObject = {
          domainName: location.hostname,
          page_url: location.href,
          tagName: "v-uptak-in",
          event: "blocked_agent",
          eventData: 1,
          uid: "",
          dep: "dependencies_vdodev_1154"
          };
          logPixel(requestObject);
              vdo_analytics("event", "blocked_agent", {
  send_to: vdo_analyticsID,
  event_category: "vdoaijs",
  event_label: "v-uptak-in",
  });
          reject();
      }
      });
  }

  function requestAllowedUrl(country) {
      return new Promise(function (resolve, reject) {
      var failsafeCheck = false;
      let statusCode = null;
      let duration = null;
      let singleRunFlag = false;

      var oReq = new XMLHttpRequest();
      const po = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
          if (entry.name.match("vdo.ai/allowed_url_go.php")) {
              duration = entry.duration;
              logAllowedUrlTiming();
          }
          }
      });

      po.observe({ entryTypes: ["resource"], longtask: { buffered: true } });

      oReq.onreadystatechange = () => {
          if (oReq.readyState === XMLHttpRequest.DONE) {
          statusCode = oReq.status;
          logAllowedUrlTiming();
          }
      };

      function logAllowedUrlTiming() {
          if (!duration || !statusCode || singleRunFlag) return;

              vdo_analytics("event", "timing_complete", {
  name: `allowed_url_response_${statusCode}`,
  value: duration,
  event_category: "video",
  send_to: vdo_analyticsID,
  event_label: "v-uptak-in",
  });
          
          singleRunFlag = true;
          po.disconnect();
      }

      oReq.onload = function () {
          try {
              vdo_analytics("event", "timing_complete", {
  name: "load_allowed_url.php",
  value: Date.now() - allowedUrlTimestamp,
  event_category: "video",
  send_to: vdo_analyticsID,
  event_label: "v-uptak-in",
  });

          if (!failsafeCheck) {
              failsafeCheck = true;
              clearTimeout(failsafeTimeout);
              var response = JSON.parse(this.response);
              adframeConfig = Object.assign(adframeConfig, response);
              adframeConfig.cached_time = Date.now();
              try {
                !adframeConfig.b_domain &&
                  sessionStorage.setItem(
                    sessionStorageKey,
                    JSON.stringify(adframeConfig)
                  );
              } catch (e) {}
              resolve(adframeConfig);
          } else {
              var response = JSON.parse(this.response);
              adframeConfig.cached_time = Date.now();
              adframeConfig = Object.assign(adframeConfig, response);
              !adframeConfig.b_domain &&
              sessionStorage.setItem(sessionStorageKey, JSON.stringify(adframeConfig));
              window[response.unitId + "_vast"] = response.vast;
              window[response.unitId + "_vast_ad_gap"] = response.vast_ad_gap;
          }
          } catch (e) {
          logError(e, "v-uptak-in");
          }
      }.bind(oReq);

      function onFailOrTimedOut() {
          if (!failsafeCheck) {
          failsafeCheck = true;
          clearTimeout(failsafeTimeout);
          var response = {
              allowed: "true",
              agent: "false",
              ip_address: "null",
              country: "unknown",
          }; // Hardcoded default response in case of call takes more than 3seconds
          adframeConfig = Object.assign(adframeConfig, response);
          resolve(adframeConfig);
          }
      }

      oReq.onerror = onFailOrTimedOut;

      var current_url = location.host + location.pathname;
      current_url = current_url
          .replace(/(\/*)$/, "")
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, "");

      var ALLOWED_URL = "https://targeting.vdo.ai/allowed_url_go.php?";
      const ALLOWED_CALL_METHOD = "GET";
      const CB = `${adframeConfig.timestamp}_${IST_TIMESTAMP}_${PST_TIMESTAMP}`;

      var ALLOWED_URL = `https://targeting.vdo.ai/allowed_url_go.php?test=cache&type=json&mul_type=os+wb&tag=v-uptak-in&domain=${adframeConfig.domain}&c=${country}&ua=${navigator.userAgent}&cb=${CB}`;

      if (adframeConfig.b_domain) {
        ALLOWED_URL += "&url=" + encodeURIComponent(current_url);
      }

      oReq.open(ALLOWED_CALL_METHOD, ALLOWED_URL, true);

      var allowedUrlTimestamp = Date.now();
      oReq.send();

      var failsafeTimeout = setTimeout(onFailOrTimedOut, 3000);
      });
  }

  function fetchCountry(URL) {
      function getCountryFromResponse(response) {
      var country = null;
      try {
          var lines = response.split("\n");
          for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          var parts = line.split("=");
          if (parts.length === 2) {
              if (parts[0] === "loc") {
              country = parts[1];
              break;
              }
          }
          }
      } catch (error) { }
      return country;
      }

      return new Promise(function (resolve, reject) {
      var country = null;
      try {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", URL, true);

          xhr.onreadystatechange = function () {
          if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
              country = getCountryFromResponse(xhr.responseText);
              resolve(country);
          }
          };

          xhr.onerror = function () {
          resolve(country);
          };

          xhr.send();
      } catch (error) {
          logError(error,"v-uptak-in"); 
          resolve(country);
      }
      });
  }

  async function loadConfig() {
    try {
    let sessionedResponse = null;
    try {
      sessionedResponse = JSON.parse(
        sessionStorage.getItem(sessionStorageKey)
      );

      if (sessionedResponse) {
        let cachedDiff =
          (Date.now() - sessionedResponse.cached_time) / 60000;
        if (cachedDiff > 29) {
          sessionedResponse = null;
          sessionStorage.removeItem(sessionStorageKey);
        }
      }
    } catch (error) {}

      if (!sessionedResponse || adframeConfig.b_domain) {
          let country = await fetchCountry(
          "https://cloudflare.com/cdn-cgi/trace"
          );
          await requestAllowedUrl(country || Date.now());
      } else {
          if(sessionedResponse.vdo_ai_initial_time) delete sessionedResponse.vdo_ai_initial_time;
          adframeConfig = Object.assign(adframeConfig, sessionedResponse);
      }
      await onConfigLoaded(adframeConfig);
      return true;
      } catch (error) {
      logError(error,"v-uptak-in");
      } finally {
      return true;
      }
  }
if (adframeConfig.dependency == undefined || !adframeConfig.dependency.length ) { adframeConfig.dependency = "dependencies_hbv4_latest"; }

Promise.all([
  loadScriptSync(
      deps +
      adframeConfig.dependency +
      "/vdo.min.js?v=" +
      (typeof version === "undefined" ? "" : version),
      "_vdo_ads_css_5654_"
  ),
  loadScriptSync(
      "//imasdk.googleapis.com/js/sdkloader/ima3.js",
      "_vdo_ads_sdk_5654_"
  ),
  loadConfig(),
  ]).then(function () {
      startTag(adframeConfig.ver);
  }).catch(function (e) {
      if (e.target) {
      var msg =
          "error_" +
          (e.target.src.indexOf("vdo.min.js") >= 0
          ? "vdo.min.js"
          : "ima3.js");
      } else {
      var msg = e;
      }
      logError(msg, 'v-uptak-in');
  });
//#endregion
})(w_vdo, d_vdo, '//a.vdo.ai/core/', 'v-uptak-in');


} catch (e) {
logError(e,'v-uptak-in');
}
