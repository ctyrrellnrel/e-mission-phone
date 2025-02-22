'use strict';

angular.module('emission.main', ['emission.main.recent',
                                 'emission.main.diary',
                                 'emission.main.control',
                                 'emission.main.goals',
                                 'emission.main.common',
                                 'emission.main.heatmap',
                                 'emission.main.metrics',
                                 'emission.config.dynamic',
                                 'emission.survey.multilabel.posttrip.map',
                                 'emission.services',
                                 'emission.services.upload'])

.config(function($stateProvider, $ionicConfigProvider, $urlRouterProvider) {
  $stateProvider
  // setup an abstract state for the tabs directive
    .state('root.main', {
    url: '/main',
    abstract: true,
    templateUrl: 'templates/main.html',
    controller: 'MainCtrl'
  })

  .state('root.main.common', {
    url: '/common',
    abstract: true,
    views: {
      'main-common': {
        templateUrl: 'templates/main-common.html',
        controller: 'CommonCtrl'
      }
    },
  })

  .state('root.main.heatmap', {
    url: '/heatmap',
    views: {
      'main-heatmap': {
        templateUrl: 'templates/main-heatmap.html',
        controller: 'HeatmapCtrl'
      }
    }
  })

  .state('root.main.metrics', {
    url: '/metrics',
    views: {
      'main-metrics': {
        templateUrl: 'templates/main-metrics.html',
        controller: 'MetricsCtrl'
      }
    }
  })

  .state('root.main.control', {
    url: '/control',
    params: {
        launchAppStatusModal: false
    },
    views: {
      'main-control': {
        templateUrl: 'templates/control/main-control.html',
        controller: 'ControlCtrl'
      }
    }
  })

  .state('root.main.goals', {
    url: '/goals',
    views: {
      'main-goals': {
        templateUrl: 'templates/main-goals.html',
        controller: 'GoalsCtrl'
      }
    }
  })

  .state('root.main.sensed', {
    url: "/sensed",
    views: {
      'main-control': {
        templateUrl: "templates/recent/sensedData.html",
        controller: 'sensedDataCtrl'
      }
    }
  })

  .state('root.main.map', {
      url: "/map",
      views: {
        'main-control': {
          templateUrl: "templates/recent/map.html",
          controller: 'mapCtrl'
        }
      }
  })

  .state('root.main.incident', {
      url: "/incident",
      params: {
        start_ts: null,
        end_ts: null
      },
      views: {
        'main-control': {
          templateUrl: "templates/incident/map.html",
          controller: 'PostTripMapCtrl'
        }
      }
  })

  .state('root.main.tripconfirm', {
      url: "/tripconfirm",
      params: {
        start_ts: null,
        end_ts: null
      },
      views: {
        'main-control': {
          templateUrl: "templates/tripconfirm/map.html",
          controller: 'PostTripMapCtrl'
        }
      }
  })

  .state('root.main.log', {
    url: '/log',
    views: {
      'main-control': {
        templateUrl: 'templates/recent/log.html',
        controller: 'logCtrl'
      }
    }
  });

  $ionicConfigProvider.tabs.style('standard')
  $ionicConfigProvider.tabs.position('bottom');
})

.controller('appCtrl', function($scope, $ionicModal, $timeout) {
    $scope.openNativeSettings = function() {
        window.Logger.log(window.Logger.LEVEL_DEBUG, "about to open native settings");
        window.cordova.plugins.BEMLaunchNative.launch("NativeSettings", function(result) {
            window.Logger.log(window.Logger.LEVEL_DEBUG,
                "Successfully opened screen NativeSettings, result is "+result);
        }, function(err) {
            window.Logger.log(window.Logger.LEVEL_ERROR,
                "Unable to open screen NativeSettings because of err "+err);
        });
    }
})

.controller('MainCtrl', function($scope, $state, $rootScope, $translate, $ionicPlatform, DynamicConfig) {
    // Currently this is blank since it is basically a placeholder for the
    // three screens. But we can totally add hooks here if we want. It is the
    // controller for all the screens because none of them do anything for now.

    moment.locale($translate.use());

    $scope.tabsCustomClass = function() {
        return "tabs-icon-top tabs-custom";
    }

    $ionicPlatform.ready().then(function() {
      DynamicConfig.configReady().then((newConfig) => {
        $scope.dCfg = newConfig;
        $scope.showDiary = !(newConfig.survey_info.buttons);
        $scope.showMetrics = newConfig.survey_info['trip-labels'] == 'MULTILABEL';
        console.log("screen-select: showDiary = "+$scope.showDiary+" metrics = "+$scope.showMetrics
            +" setting tabSel to done");
        console.log("screen-select: in dynamic config load, tabs list is ", $('.tab-item'));
      });
    });

    $scope.$on('$ionicView.enter', function(ev) {
        console.log("screen-select: after view enter, tabs list is ", $('.tab-item'));
        const labelEl = $('.tab-item[icon="ion-checkmark-round"]')
        const diaryEl = $('.tab-item[icon="ion-map"]')
        const dashboardEl = $('.tab-item[icon="ion-ios-analytics"]')
        console.log("screen-select: label ",labelEl," diary ",diaryEl," dashboardEl" ,dashboardEl);
        // If either these don't exist, we will get an empty array.
        // preceding or succeeding with an empty array is a NOP
        labelEl.before(diaryEl);
        labelEl.after(dashboardEl);
    });
});
