'use strict';

angular.module('emission.survey.external.launch', ['emission.services',
                    'emission.plugin.logger',
                    'emission.stats.clientstats'])

.factory('SurveyLaunch', function($http, $window, $ionicPopup, $rootScope, ClientStats,
    CommHelper, Logger) {

    var surveylaunch = {};
    var replace_uuid= function(iab, elementSelector, scriptFile) {
        return Promise.all([$http.get(scriptFile),
                     CommHelper.getUser()])
          .then(function([scriptText, userProfile]) {
            // alert("finished loading script");
            Logger.log(scriptText.data);
            var uuid = userProfile.user_id['$uuid']
            // I tried to use http://stackoverflow.com/posts/23387583/revisions
            // for the idea on how to invoke the function in the script
            // file, but the callback function was never invoked. So I edit the
            // script file directly and insert the userId.
            Logger.log("inserting user id into survey. userId = "+ uuid
                        +" element selector = "+elementSelector);
            var codeTemplate = scriptText.data;
            var codeString = codeTemplate.replace("SCRIPT_REPLACE_VALUE", uuid)
                                .replace("SCRIPT_REPLACE_ELEMENT_SEL", elementSelector);
            Logger.log(codeString);
            return iab.executeScript({ code: codeString });
          });
    };

    var replace_time = function(iab, tsElementId, fmtTimeElementId, ts, label) {
        // we don't need to get the user because we have the timestamp right here
        return Promise.all([$http.get("js/survey/time_insert.js")])
          .then(function([scriptText]) {
            // alert("finished loading script");
            Logger.log(scriptText.data);
            // I tried to use http://stackoverflow.com/posts/23387583/revisions
            // for the idea on how to invoke the function in the script
            // file, but the callback function was never invoked. So I edit the
            // script file directly and insert the userId.
            Logger.log("inserting ts into survey. ts = "+ ts
                        +" element id = "+tsElementId
                        +" fmtTime"+moment.unix(ts).format()
                        +" element id = "+fmtTimeElementId);
            var codeTemplate = scriptText.data;
            var tsCodeString = codeTemplate.replace("SCRIPT_REPLACE_VALUE", ts)
                                .replace("SCRIPT_REPLACE_ELEMENT_ID", tsElementId)
                                .replace(/LABEL/g, label+"Ts");
            Logger.log("After ts replace" + tsCodeString);
            $cordovaInAppBrowser.executeScript({ code: tsCodeString });
            var fmtTimeCodeString = codeTemplate.replace("SCRIPT_REPLACE_VALUE", moment.unix(ts).format())
                                .replace("SCRIPT_REPLACE_ELEMENT_ID", fmtTimeElementId)
                                .replace(/LABEL/g, label+"FmtTime");
            Logger.log("After fmtTimeCode replace" + tsCodeString);
            iab.executeScript({ code: fmtTimeCodeString });
          });
    };
    

    // BEGIN: startSurveyForCompletedTrip

    // Put the launch in one place so that 
    surveylaunch.options = "location=yes,clearcache=no,toolbar=yes,hideurlbar=yes";
    /*
    surveylaunch.options = {
        location: window.cordova.platformId == 'ios'? 'no' : 'yes',
        clearcache: 'no',
        toolbar: 'yes',
        hideurlbar: 'yes'
    };
    */

    surveylaunch.startSurveyForCompletedTrip = function (url, uuidElementId, 
                                                         startTsElementId,
                                                         endTsElementId,
                                                         startFmtTimeElementId,
                                                         endFmtTimeElementId,
                                                         startTs,
                                                         endTs) {
      // THIS LINE FOR inAppBrowser
      let iab = $window.cordova.InAppBrowser.open(url, '_blank', surveylaunch.options);

      iab.addEventListener("loadstop", function(event) {
        console.log("successfully opened page with result "+JSON.stringify(event));
        // success
        Promise.all([replace_uuid(iab, uuidElementId, "js/survey/uuid_insert.js"),
                     replace_time(iab, startTsElementId, startFmtTimeElementId, startTs, "Start"),
                     replace_time(iab, endTsElementId, endFmtTimeElementId, endTs, "End")])
        .catch(function(error) { // catch for all promises
          $ionicPopup.alert({"template": "Relaunching survey - while replacing uuid, got error "+ JSON.stringify(error)})
          .then(function() {
            surveylaunch.startSurvey(url, uuidElementId,
                startTsElementId, endTsElementId,
                startFmtTimeElementId, endTsElementId,
                startTs, endTs);
          });
        });
      })

      iab.addEventListener('loaderror', function(event) {
            Logger.displayError("Unable to launch survey", JSON.stringify(event));
      });

      iab.addEventListener('loadstart', function(event) {
        console.log("started loading, event = "+JSON.stringify(event));
        /*
        if (event.url == 'https://bic2cal.eecs.berkeley.edu/') {
            $cordovaInAppBrowser.close();
        }
        */
      });
      iab.addEventListener('exit', function(event) {
        console.log("exiting, event = "+JSON.stringify(event));
        // we could potentially restore the close-on-bic2cal functionality above
        // if we unregistered here
      });
    }
    // END: startSurveyForCompletedTrip

    var startSurveyCommon = function (url, elementSelector, elementSelScriptFile) {
      // THIS LINE FOR inAppBrowser
      let iab = $window.cordova.InAppBrowser.open(url, '_blank', surveylaunch.options);
      iab.addEventListener("loadstop", function(event) {
        console.log("successfully opened page with result "+JSON.stringify(event));
        // success
        replace_uuid(iab, elementSelector, elementSelScriptFile)
        .catch(function(error) {
          iab.close();
          $ionicPopup.alert({"template": "Relaunching survey - while replacing uuid, got error "+ error})
          .then(function() {
            startSurveyCommon(url,elementSelector, elementSelScriptFile);
          });
        });
      });

      iab.addEventListener('loaderror', function(event) {
        Logger.displayError("Unable to launch survey", event);
      });

      iab.addEventListener("loadstart", function(event) {
        console.log("started loading, event = "+JSON.stringify(event));
        /*
        if (event.url == 'https://bic2cal.eecs.berkeley.edu/') {
            $cordovaInAppBrowser.close();
        }
        */
      });

      iab.addEventListener('exit', function(event) {
        console.log("exiting, event = "+JSON.stringify(event));
        // we could potentially restore the close-on-bic2cal functionality above
        // if we unregistered here
      });
    };

    surveylaunch.startSurveyWithID = function (url, uuidElementId) {
        startSurveyCommon(url, uuidElementId, "js/survey/uuid_insert_id.js");
    }

    surveylaunch.startSurveyWithXPath = function (url, elementXPath) {
        startSurveyCommon(url, elementXPath, "js/survey/uuid_insert_xpath.js");
    }

    /**
     * startSurveyPrefilled start the survey and prefill the UUID field.
     * @param {string} url survey url
     * @param {{
     *  uuidSearchParam: string
     *  returnURLSearchParam: string
     *  returnURL: string
     *  autoCloseURL: string
     * }} [opts] options
     */
    surveylaunch.startSurveyPrefilled = function (url, opts = {}) {
      opts = Object.assign({
        uuidSearchParam: 'uuid',
        returnURLSearchParam: 'return_url',
        returnURL: '',
        autoCloseURL: undefined,
      }, opts);
      return CommHelper.getUser().then(function(userProfile) {
        // alert("finished loading script");
        let uuid = userProfile.user_id['$uuid']
        Logger.log("inserting user id into survey. userId = "+ uuid
                      +" base url = "+url);
        const urlObj = new URL(url);
        urlObj.searchParams.append(opts.returnURLSearchParam, encodeURIComponent(opts.returnURL));
        urlObj.searchParams.append(opts.uuidSearchParam, uuid);
        const modifiedURL = urlObj.toString();
        Logger.log("modified URL = "+modifiedURL);
        let iab = $window.cordova.InAppBrowser.open(modifiedURL, '_blank', surveylaunch.options);
        iab.addEventListener('loaderror', function(event) {
          Logger.displayError("Unable to launch survey", event);
          return Promise.reject();
        });
        if (opts.autoCloseURL) {
          return new Promise((resolve, reject) => {
            const autoClose = function(event) {
              console.log("started loading, event = " + JSON.stringify(event));
              if (opts.autoCloseURL.includes(event.url)) {
                iab.removeEventListener('loadstart', autoClose);
                iab.close();
                return resolve();
              }
            };
            iab.addEventListener('loadstart', autoClose);
          });
        }
        return Promise.resolve();
      });
    }

    surveylaunch.init = function() {
      $rootScope.$on('cloud:push:notification', function(event, data) {
        ClientStats.addEvent(ClientStats.getStatKeys().NOTIFICATION_OPEN).then(
            function() {
                console.log("Added "+ClientStats.getStatKeys().NOTIFICATION_OPEN+" event. Data = " + JSON.stringify(data));
              });
        Logger.log("data = "+JSON.stringify(data));
        if (angular.isDefined(data.additionalData) &&
            angular.isDefined(data.additionalData.payload) &&
            angular.isDefined(data.additionalData.payload.alert_type) &&
            data.additionalData.payload.alert_type == "survey") {
            var survey_spec = data.additionalData.payload.spec;
            if (angular.isDefined(survey_spec) &&
                angular.isDefined(survey_spec.url)) {
                if (angular.isDefined(survey_spec.uuidElementId)) {
                  surveylaunch.startSurveyWithID(survey_spec.url, survey_spec.uuidElementId);
                } else if (angular.isDefined(survey_spec.uuidXPath)) {
                  surveylaunch.startSurveyWithXPath(survey_spec.url, survey_spec.uuidXPath);
                } else if (angular.isDefined(survey_spec.uuidSearchParam)) {
                  surveylaunch.startSurveyPrefilled(survey_spec.url, {
                    uuidSearchParam: survey_spec.uuidSearchParam
                  });
                } else {
                    $ionicPopup.alert("survey was not specified correctly. spec is "+JSON.stringify(survey_spec));
                }
            } else {
                $ionicPopup.alert("survey was not specified correctly. spec is "+JSON.stringify(survey_spec));
            }
        }
      });
    };

    surveylaunch.init();
    return surveylaunch;
});
