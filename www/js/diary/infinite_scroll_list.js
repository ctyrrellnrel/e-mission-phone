'use strict';

/*
 * The general structure of this code is that all the timeline information for
 * a particular day is retrieved from the Timeline factory and put into the scope.
 * For best performance, all data should be loaded into the in-memory timeline,
 * and in addition to writing to storage, the data should be written to memory.
 * All UI elements should only use $scope variables.
 */

angular.module('emission.main.diary.infscrolllist',['ui-leaflet',
                                      'ionic-datepicker',
                                      'emission.main.common.services',
                                      'emission.tripconfirm.multilabel',
                                      'emission.tripconfirm.verifycheck',
                                      'emission.services',
                                      'ng-walkthrough', 'nzTour', 'emission.plugin.kvstore',
                                      'emission.main.diary.infscrollfilters',
                                      'emission.stats.clientstats',
                                      'emission.plugin.logger'])

.controller("InfiniteDiaryListCtrl", function($window, $scope, $rootScope, $injector,
                                    $ionicPlatform, $state,
                                    $ionicScrollDelegate, $ionicPopup, ClientStats,
                                    $ionicLoading,
                                    $ionicActionSheet,
                                    $timeout,
                                    ionicDatePicker,
                                    leafletData, Timeline, CommonGraph, DiaryHelper,
    Config, PostTripManualMarker, nzTour, KVStore, Logger, UnifiedDataLoader, $ionicPopover, $ionicModal, $translate) {

  // TODO: load only a subset of entries instead of everything

  console.log("controller InfiniteDiaryListCtrl called");
  // Add option

  const placeLimiter = new Bottleneck({ maxConcurrent: 2, minTime: 500 });

  $scope.data = {};
  $scope.tripFilterFactory = $injector.get("InfScrollFilters");
  $scope.filterInputs = $scope.tripFilterFactory.configuredFilters;

  $scope.labelPopulateFactory = $injector.get("MultiLabelService");

  $scope.getActiveFilters = function() {
    return $scope.filterInputs.filter(sf => sf.state).map(sf => sf.key);
  }
  $scope.filterInputs.forEach((f) => {
    f.state = false;
  });
  $scope.filterInputs[0].state = true;
  ClientStats.addReading(ClientStats.getStatKeys().LABEL_TAB_SWITCH, {"source": null, "dest": $scope.getActiveFilters()});
  $scope.allTrips = false;
  const ONE_WEEK = 7 * 24 * 60 * 60; // seconds

  /*
   * These values are used to ensure that when the user scrolls upwards, they
   * end up at the same location as they were. Since we now add entries to the
   * top of the list, without these changes, as we load more entries, we will
   * see the top of the new entries and will potentially have to scroll down to
   * find where we originally were.
   * That is not terrible, but it is also not super intuitive. This keeps track
   * of where we were from the bottom and scrolls back to that location after
   * the data is loaded and the infiniteScrollCallback is broadcast.
   *
   * We need to define and store the callback since we want to scroll *after*
   * the new items have been fully added (i.e. in the `$scope.$on`). If the
   * focus group is ok with seeing the newly loaded trips first, we can
   * simplify this.
   */
  $scope.infScrollControl = {fromBottom: -1, callback: undefined};

  var adjustScrollAfterDownload = function() {
    // This whole "infinite scroll upwards" implementation is quite hacky, but after hours of work on it, it's the only way I could approximate the desired behavior.
    $ionicScrollDelegate.scrollBottom();
    const clientHeight = $ionicScrollDelegate.getScrollView().__clientHeight;
    $ionicScrollDelegate.scrollBy(0, -$scope.infScrollControl.fromBottom+clientHeight);
  };

  var getFromBottom = function() {
    return $ionicScrollDelegate.getScrollView().__contentHeight
        - $ionicScrollDelegate.getScrollPosition().top;
  }

  $scope.readDataFromServer = function() {
    $scope.infScrollControl.fromBottom = getFromBottom()
    $scope.infScrollControl.callback = adjustScrollAfterDownload;
    console.log("calling readDataFromServer with "+
        JSON.stringify($scope.infScrollControl));
    const currEnd = $scope.infScrollControl.currentEnd;
    if (!angular.isDefined(currEnd)) {
        console.log("trying to read data too early, early return");
        $scope.$broadcast('scroll.infiniteScrollComplete')
        return;
    }
    Timeline.readAllConfirmedTrips(currEnd, ONE_WEEK).then((ctList) => {
        Logger.log("Received batch of size "+ctList.length);
        ctList.forEach($scope.populateBasicClasses);
        ctList.forEach((trip, tIndex) => {
            trip.nextTrip = ctList[tIndex+1];
            $scope.labelPopulateFactory.populateInputsAndInferences(trip, $scope.data.manualResultMap);
        });
        // Fill places on a reversed copy of the list so we fill from the bottom up
        ctList.slice().reverse().forEach(function(trip, index) {
            fillPlacesForTripAsync(trip);
        });
        $scope.data.allTrips = ctList.concat($scope.data.allTrips);
        Logger.log("After adding batch of size "+ctList.length+" cumulative size = "+$scope.data.allTrips.length);
        const oldestTrip = ctList[0];
        if (oldestTrip) {
            if (oldestTrip.start_ts <= $scope.infScrollControl.pipelineRange.start_ts) {
                Logger.log("Oldest trip in batch starts at "+ moment(oldestTrip.start_ts)
                    +" pipeline starts at "+moment($scope.infScrollControl.pipelineRange.start_ts)
                    +" reached end");
                $scope.infScrollControl.reachedEnd = true;
            } else {
                // Since this was reversed, the first entry is the most recent
                $scope.infScrollControl.currentEnd =
                    oldestTrip.end_ts - 1;
                Logger.log("new end time = "+$scope.infScrollControl.currentEnd);
            }
        } else {
            Logger.log("current batch of size 0 but haven't reached pipeline start, going on");
            $scope.infScrollControl.currentEnd = $scope.infScrollControl.currentEnd - ONE_WEEK;
        }
        $scope.recomputeDisplayTrips();
        Logger.log("Broadcasting infinite scroll complete");
        $scope.$broadcast('scroll.infiniteScrollComplete');

    }).catch((err) => {
        Logger.displayError("while reading confirmed trips", err);
        Logger.log("Reached the end of the scrolling");
        $scope.infScrollControl.reachedEnd = true;
        Logger.log("Broadcasting infinite scroll complete");
        $scope.$broadcast('scroll.infiniteScrollComplete');
    });
  };

  $scope.setupInfScroll = function() {
    Logger.log("Setting up the scrolling");
    $scope.infScrollControl.reachedEnd = false;
    $scope.data.allTrips = [];
    $scope.data.displayTrips = [];
    Timeline.getUnprocessedLabels().then(([pipelineRange, manualResultMap]) => {
        if (pipelineRange.end_ts) {
            $scope.$apply(() => {
              $scope.data.manualResultMap = manualResultMap;
            });
            console.log("After reading in the label controller, manualResultMap "+JSON.stringify($scope.manualResultMap), $scope.data.manualResultMap);
            $scope.infScrollControl.pipelineRange = pipelineRange;
            $scope.infScrollControl.currentEnd = pipelineRange.end_ts;
            $scope.infScrollControl.callback = function() {
              $ionicScrollDelegate.scrollBottom();
            };
            $scope.readDataFromServer();
        } else {
            $scope.$apply(() => {
                $scope.infScrollControl.reachedEnd = true;
            });
            $scope.$broadcast('scroll.infiniteScrollComplete')
        }
    });
  }

  $scope.$on("scroll.infiniteScrollComplete", function() {
    Logger.log("infiniteScrollComplete broadcast")
    if ($scope.infScrollControl.callback != undefined) {
      $scope.infScrollControl.callback();
      $scope.infScrollControl.callback = undefined;
    }
  });

  $ionicModal.fromTemplateUrl("templates/diary/trip-detail-popover.html", {
    scope: $scope,
    animation: 'slide-in-up'
  }).then((popover) => {
    $scope.tripDetailPopover = popover;
  });

  $scope.showDetail = function($event, trip) {
    Timeline.confirmedTrip2Geojson(trip).then((tripgj) => {
        $scope.currgj = trip;
        $scope.currgj.data = tripgj;
        $scope.currgj.pointToLayer = DiaryHelper.pointFormat;
        $scope.tripDetailPopover.show();
        leafletData.getMap("detailPopoverMap").then(function(map) {
            map.invalidateSize();
        });
    });
  }

  $scope.select = function(selF) {
    const prev = $scope.getActiveFilters();
    selF.state = true;
    $scope.filterInputs.forEach((f) => {
      if (f !== selF) {
        f.state = false;
      }
    });
    $scope.allTrips = false;
    $scope.recomputeDisplayTrips();
    // scroll to the bottom while changing filters so users don't have to
    // fixes the first of the fit-and-finish issues from
    // https://github.com/e-mission/e-mission-docs/issues/662
    $ionicScrollDelegate.scrollBottom();
    ClientStats.addReading(ClientStats.getStatKeys().LABEL_TAB_SWITCH, {"source": prev, "dest": $scope.getActiveFilters()});
  }

  $scope.resetSelection = function() {
    const prev = $scope.getActiveFilters();
    $scope.filterInputs.forEach((f) => {
      f.state = false;
    });
    $scope.allTrips = true;
    $scope.recomputeDisplayTrips();
    $ionicScrollDelegate.scrollBottom();
    ClientStats.addReading(ClientStats.getStatKeys().LABEL_TAB_SWITCH, {"source": prev, "dest": $scope.getActiveFilters()});
  }

  $scope.recomputeDisplayTrips = function() {
    let alreadyFiltered = false;
    $scope.filterInputs.forEach((f) => {
        if (f.state == true) {
            if (alreadyFiltered) {
                Logger.displayError("multiple filters not supported!", undefined);
            } else {
                // console.log("Trip n before: "+$scope.data.displayTrips.length);
                $scope.data.displayTrips = $scope.data.allTrips.filter(
                    t => (t.waitingForMod == true) || f.filter(t));
                // console.log("Trip n after:  "+$scope.data.displayTrips.length);
                alreadyFiltered = true;
            }
        }
    });
    if (!alreadyFiltered) {
        $scope.data.displayTrips = $scope.data.allTrips;
    };
  }

  angular.extend($scope, {
      defaults: {
          zoomControl: false,
          dragging: true,
          zoomAnimation: false,
          touchZoom: true,
          doubleClickZoom: true,
          boxZoom: true,
      }
  });

  angular.extend($scope.defaults, Config.getMapTiles())

//   moment.locale('en', {
//   relativeTime : {
//       future: "in %s",
//       past:   "%s ago",
//       s:  "secs",
//       m:  "a min",
//       mm: "%d m",
//       h:  "an hr",
//       hh: "%d h",
//       d:  "a day",
//       dd: "%d days",
//       M:  "a month",
//       MM: "%d months",
//       y:  "a year",
//       yy: "%d years"
//   }
// });

    /*
    * While working with dates, note that the datepicker needs a javascript date because it uses
    * setHours here, while the currDay is a moment, since we use it to perform
    * +date and -date operations.
    */
    $scope.listExpandClass = "earlier-later-expand";
    $scope.listLocationClass = "item item-icon-left list-location";
    $scope.listTextClass = "list-text";

    $scope.listCardClass = function(tripgj) {
      var background = tripgj.background;
      if ($window.screen.width <= 320) {
        return "list card list-card "+ background +" list-card-sm";
      } else if ($window.screen.width <= 375) {
        return "list card list-card "+ background +" list-card-md";
      } else {
        return "list card list-card "+background+" list-card-lg";
      }

    }
    $scope.listColLeftClass = function(margin) {
      if (margin == 0) {
        return "col-50 list-col-left";
      } else {
        return "col-50 list-col-left-margin";
      }
    }
    $scope.listColRightClass = "col-50 list-col-right"

    $scope.differentCommon = function(tripgj) {
        return ($scope.isCommon(tripgj.id))? ((DiaryHelper.getEarlierOrLater(tripgj.data.properties.start_ts, tripgj.data.id) == '')? false : true) : false;
    }
    $scope.stopTimeTagClass = function(tripgj) {
      return ($scope.differentCommon(tripgj))? "stop-time-tag-lower" : "stop-time-tag";
    }

    $scope.populateBasicClasses = function(tripgj) {
        tripgj.display_start_time = DiaryHelper.getLocalTimeString(tripgj.start_local_dt);
        tripgj.display_end_time = DiaryHelper.getLocalTimeString(tripgj.end_local_dt);
        tripgj.display_distance = DiaryHelper.getFormattedDistance(tripgj.distance);
        tripgj.display_date = moment(tripgj.start_ts * 1000).format('ddd DD MMM YY');
        tripgj.display_time = DiaryHelper.getFormattedTimeRange(tripgj.start_ts,
                                tripgj.end_ts);
        tripgj.background = "bg-light";
        tripgj.listCardClass = $scope.listCardClass(tripgj);
        // Pre-populate start and end names with &nbsp; so they take up the same amount of vertical space in the UI before they are populated with real data
        tripgj.start_display_name = "\xa0";
        tripgj.end_display_name = "\xa0";
    }

    const fillPlacesForTripAsync = function(tripgj) {
        const fillPromises = [
            placeLimiter.schedule(() =>
                CommonGraph.getDisplayName('cplace', {location: tripgj.start_loc})),
            placeLimiter.schedule(() =>
                CommonGraph.getDisplayName('cplace', {location: tripgj.end_loc})),
        ];
        Promise.all(fillPromises).then(function([startName, endName]) {
            $scope.$apply(() => {
                tripgj.start_display_name = startName;
                tripgj.end_display_name = endName;
            });
        });
    }

    $scope.populateCommonInfo = function(tripgj) {
        tripgj.common = {}
        DiaryHelper.fillCommonTripCount(tripgj);
        tripgj.common.different = $scope.differentCommon(tripgj);
        tripgj.common.longerOrShorter = $scope.getLongerOrShorter(tripgj.data, tripgj.data.id);
        tripgj.common.listColLeftClass = $scope.listColLeftClass(tripgj.common.longerOrShorter[0]);
        tripgj.common.stopTimeTagClass = $scope.stopTimeTagClass(tripgj);
        tripgj.common.arrowColor = $scope.arrowColor(tripgj.common.longerOrShorter[0]);
        tripgj.common.arrowClass = $scope.getArrowClass(tripgj.common.longerOrShorter[0]);

        tripgj.common.earlierOrLater = $scope.getEarlierOrLater(tripgj.data.properties.start_ts, tripgj.data.id);
        tripgj.common.displayEarlierLater = $scope.parseEarlierOrLater(tripgj.common.earlierOrLater);
    }

    $scope.refresh = function() {
       $scope.setupInfScroll();
    };

    // Tour steps
    var tour = {
      config: {
        mask: {
          visibleOnNoTarget: true,
          clickExit: true,
        },
        previousText: $translate.instant('tour-previous'),
        nextText: $translate.instant('tour-next'),
        finishText: $translate.instant('tour-finish')
      },
      steps: [{
        target: '.ion-view-background',
        content: $translate.instant('new_label_tour.0')
      },
      {
        target: '.labelfilter',
        content: $translate.instant('new_label_tour.1')
      },
      {
        target: '.labelfilter.last',
        content: $translate.instant('new_label_tour.2')
      },
      {
        target: '.diary-entry',
        content: $translate.instant('new_label_tour.3')
      },
      {
        target: '.control-icon-button',
        content: $translate.instant('new_label_tour.4'),
        before: function() {
          return new Promise(function(resolve, reject) {
            $ionicScrollDelegate.scrollTop(true);
            resolve();
          });
        }
      },
      {
        target: '.diary-entry',
        content: $translate.instant('new_label_tour.5')
      },
      {
        target: '.diary-entry',
        content: $translate.instant('new_label_tour.6')
      },
      {
        target: '.diary-entry',
        content: $translate.instant('new_label_tour.7')
      },
      {
        target: '.diary-entry',
        content: $translate.instant('new_label_tour.8'),
        after: function() {
          return new Promise(function(resolve, reject) {
            $ionicScrollDelegate.scrollBottom(true);
            resolve();
          });
        }
      },
      {
        target: '.labelfilter',
        content: $translate.instant('new_label_tour.9')
      },
      {
        target: '.ion-view-background',
        content: $translate.instant('new_label_tour.10')
      },
      {
        target: '.walkthrough-button',
        content: $translate.instant('new_label_tour.11')
      }
      ]
    };

    var startWalkthrough = function () {
      nzTour.start(tour).then(function(result) {
        Logger.log("list walkthrough start completed, no error");
      }).catch(function(err) {
        Logger.displayError("list walkthrough start errored", err);
      });
    };

    /*
    * Checks if it is the first time the user has loaded the new label tab. If it is then
    * show a walkthrough and store the info that the user has seen the tutorial.
    */
    var checkNewlabelTutorialDone = function () {
      var NEWLABEL_DONE_KEY = 'newlabel_tutorial_done';
      var newlabelTutorialDone = KVStore.getDirect(NEWLABEL_DONE_KEY);
      if (!newlabelTutorialDone) {
        startWalkthrough();
        KVStore.set(NEWLABEL_DONE_KEY, true);
      }
    };

    $scope.startWalkthrough = function () {
      startWalkthrough();
    }

    $scope.$on('$ionicView.enter', function(ev) {
      $scope.startTime = moment().utc()
      // This workaround seems to no longer work
      // In any case, only the first call to checkNewlabelTutorialDone does anything
      /*// Workaround from
      // https://github.com/driftyco/ionic/issues/3433#issuecomment-195775629
      if(ev.targetScope !== $scope)
        return;*/
      // checkNewlabelTutorialDone();
    });

    $scope.$on('$ionicView.leave',function() {
      var timeOnPage = moment().utc() - $scope.startTime;
      ClientStats.addReading(ClientStats.getStatKeys().INF_SCROLL_TIME, timeOnPage);
    });

    $ionicPlatform.on("pause", function() {
      if ($state.$current == "root.main.diary.list") {
        var timeOnPage = moment().utc() - $scope.startTime;
        ClientStats.addReading(ClientStats.getStatKeys().INF_SCROLL_TIME, timeOnPage);
      }
    })

    $ionicPlatform.on("resume", function() {
      if ($state.$current == "root.main.diary.list") {
        $scope.startTime = moment().utc()
      }
    })

    $ionicPlatform.ready().then(function() {
      $scope.setupInfScroll();
      $scope.isAndroid = $window.device.platform.toLowerCase() === "android";

      $scope.$on('$ionicView.enter', function(ev) {
        // This workaround seems to no longer work
        // In any case, only the first call to checkNewlabelTutorialDone does anything
        /*// Workaround from
        // https://github.com/driftyco/ionic/issues/3433#issuecomment-195775629
        if(ev.targetScope !== $scope)
          return;*/
        // checkNewlabelTutorialDone();
      });

      $scope.$on('$ionicView.afterEnter', function() {
        ClientStats.addEvent(ClientStats.getStatKeys().CHECKED_INF_SCROLL).then(function() {
           console.log("Added "+ClientStats.getStatKeys().CHECKED_INF_SCROLL+" event");
        });
        if($rootScope.barDetail){
          readAndUpdateForDay($rootScope.barDetailDate);
          $rootScope.barDetail = false;
        }
      });
    });
});
