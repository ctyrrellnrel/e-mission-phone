/*
 * Directive to display a survey to add notes to a timeline entry (trip or place)
 */

angular.module('emission.survey.enketo.add-note-button',
    ['emission.stats.clientstats',
        'emission.services',
        'emission.config.dynamic',
        'emission.survey.enketo.launch',
        'emission.survey.enketo.answer',
        'emission.survey.enketo.preview',
        'emission.survey.inputmatcher'])
.directive('enketoAddNoteButton', function() {
  return {
    scope: {
      timelineEntry: '=',
      notesConfig: '=',
      datakey: '@',
    },
    controller: "EnketoAddNoteButtonCtrl",
    templateUrl: 'templates/survey/enketo/add-note-button.html'
  };
})
.controller("EnketoAddNoteButtonCtrl", function($scope, $element, $attrs, $translate,
    EnketoSurveyLaunch, $ionicPopover, ClientStats, DynamicConfig,
    EnketoNotesButtonService) {
  console.log("Invoked enketo directive controller for add-note-button");
  $scope.notes = [];

  const updateLabel = () => {
    const localeCode = $translate.use();
    if ($scope.notesConfig?.['filled-in-label'] && timelineEntry.additionsList?.length > 0) {
      $scope.displayLabel = $scope.notesConfig?.['filled-in-label']?.[localeCode];
    } else {
      $scope.displayLabel = $scope.notesConfig?.['not-filled-in-label']?.[localeCode];
    }
  }
  $scope.$watch('notesConfig', updateLabel);
  $scope.$watch('timelineEntry.additionsList', updateLabel);

  // return a dictionary of fields we want to prefill, using start/enter and end/exit times
  $scope.getPrefillTimes = () => {

    let begin = $scope.timelineEntry.start_ts || $scope.timelineEntry.enter_ts;
    let stop = $scope.timelineEntry.end_ts || $scope.timelineEntry.exit_ts;

    // if addition(s) already present on this timeline entry, `begin` where the last one left off
    $scope.timelineEntry.additionsList.forEach(a => {
      if (a.data.end_ts > (begin || 0) && a.data.end_ts != stop)
        begin = a.data.end_ts;
    });
    
    const timezone = $scope.timelineEntry.start_local_dt?.timezone
                      || $scope.timelineEntry.enter_local_dt?.timezone
                      || $scope.timelineEntry.end_local_dt?.timezone
                      || $scope.timelineEntry.exit_local_dt?.timezone;
    const momentBegin = begin ? moment(begin * 1000).tz(timezone) : null;
    const momentStop = stop ? moment(stop * 1000).tz(timezone) : null;

    const prefills = {}
    // Fill in only the fields that are present
    // Enketo requires these specific date/time formats
    if (momentBegin) {
      prefills.Start_date = momentBegin.format('YYYY-MM-DD');
      prefills.Start_time = momentBegin.format('HH:mm:ss.SSSZ');
    } else {
      prefills.Start_date = momentStop.format('YYYY-MM-DD');
    }

    if (momentStop) {
      prefills.End_date = momentStop.format('YYYY-MM-DD');
      prefills.End_time = momentStop.format('HH:mm:ss.SSSZ');
    }

    return prefills;
  }

  const getScrollElement = function() {
    if (!$scope.scrollElement) {
        console.log("scrollElement is not cached, trying to read it ");
        const ionItemElement = $element.closest('ion-item')
        if (ionItemElement) {
            console.log("ionItemElement is defined, we are in a list, finding the parent scroll");
            $scope.scrollElement = ionItemElement.closest('ion-content');
        } else {
            console.log("ionItemElement is defined, we are in a detail screen, ignoring");
        }
    }
    // TODO: comment this out after testing to avoid log spew
    console.log("Returning scrollElement ", $scope.scrollElement);
    return $scope.scrollElement;
  }

  $scope.openPopover = function ($event, timelineEntry, inputType) {
    const surveyName = $scope.notesConfig.surveyName;
    console.log('About to launch survey ', surveyName);

    // prevents the click event from bubbling through to the card and opening the details page
    if ($event.stopPropagation) $event.stopPropagation();
    return EnketoSurveyLaunch
      .launch($scope, surveyName, { timelineEntry: timelineEntry, prefillFields: $scope.getPrefillTimes(), dataKey: $scope.datakey })
      .then(result => {
        if (!result) {
          return;
        }
        const addition = {
          data: result,
          write_ts: Date.now(),
          key: $scope.datakey
        };

        // adding the addition for display is handled in infinite_scroll_list.js
        $scope.$emit('enketo.noteAddition', addition, getScrollElement());
        
        // store is commented out since the enketo survey launch currently
        // stores the value as well
        // $scope.store(inputType, result, false);
      });
  };
})
.factory("EnketoNotesButtonService", function(InputMatcher, EnketoSurveyAnswer, Logger, $timeout) {
  var enbs = {};
  console.log("Creating EnketoNotesButtonService");
  enbs.SINGLE_KEY="NOTES";
  enbs.MANUAL_KEYS = [];

  /**
   * Set the keys for trip and/or place additions whichever will be enabled,
   * and sets the name of the surveys they will use.
   */
  enbs.initConfig = function(tripSurveyName, placeSurveyName) {
    enbs.tripSurveyName = tripSurveyName;
    if (tripSurveyName) {
       enbs.MANUAL_KEYS.push("manual/trip_addition_input")
    }
    enbs.placeSurveyName = placeSurveyName;
    if (placeSurveyName) {
       enbs.MANUAL_KEYS.push("manual/place_addition_input")
    }
  }

  /**
   * Embed 'inputType' to the timelineEntry.
   */
  enbs.extractResult = function(results) {
    const resultsPromises = [EnketoSurveyAnswer.filterByNameAndVersion(enbs.timelineEntrySurveyName, results)];
    if (enbs.timelineEntrySurveyName != enbs.placeSurveyName) {
      resultsPromises.push(EnketoSurveyAnswer.filterByNameAndVersion(enbs.placeSurveyName, results));
    }
    return Promise.all(resultsPromises);
  };

  enbs.processManualInputs = function(manualResults, resultMap) {
    console.log("ENKETO: processManualInputs with ", manualResults, " and ", resultMap);
    const surveyResults = manualResults.flat(2);
    resultMap[enbs.SINGLE_KEY] = surveyResults;
  }

  enbs.populateInputsAndInferences = function(timelineEntry, manualResultMap) {
    console.log("ENKETO: populating timelineEntry,", timelineEntry, " with result map", manualResultMap);
    if (angular.isDefined(timelineEntry)) {
        // initialize additions array as empty if it doesn't already exist
        timelineEntry.additionsList ||= [];
        enbs.populateManualInputs(timelineEntry, enbs.SINGLE_KEY, manualResultMap[enbs.SINGLE_KEY]);
    } else {
        console.log("timelineEntry information not yet bound, skipping fill");
    }
  }

  /**
   * Embed 'inputType' to the timelineEntry
   * This is the version that is called from the list, which focuses only on
   * manual inputs. It also sets some additional values 
   */
  enbs.populateManualInputs = function (timelineEntry, inputType, inputList) {
      // there is not necessarily just one addition per timeline entry,
      // so unlike user inputs, we don't want to replace the server entry with
      // the unprocessed entry
      // but we also don't want to blindly append the unprocessed entry; what
      // if it was a deletion.
      // what we really want to do is to merge the unprocessed and processed entries
      // taking deletion into account
      // one option for that is to just combine the processed and unprocessed entries
      // into a single list
      // note that this is not necessarily the most performant approach, since we will
      // be re-matching entries that have already been matched on the server
      // but the number of matched entries is likely to be small, so we can live
      // with the performance for now
      const unprocessedAdditions = InputMatcher.getAdditionsForTimelineEntry(timelineEntry, inputList);
      const combinedPotentialAdditionList = timelineEntry.additions.concat(unprocessedAdditions);
      const dedupedList = InputMatcher.getUniqueEntries(combinedPotentialAdditionList);
      Logger.log("After combining unprocessed ("+unprocessedAdditions.length+
        ") with server ("+timelineEntry.additions.length+
        ") for a combined ("+combinedPotentialAdditionList.length+
        "), deduped entries are ("+dedupedList.length+")");

      enbs.populateInput(timelineEntry.additionsList, inputType, dedupedList);
      // Logger.log("Set "+ inputType + " " + JSON.stringify(userInputEntry) + " for trip starting at " + JSON.stringify(trip.start_fmt_time));
      enbs.editingTrip = angular.undefined;
  }

  /**
   * Insert the given userInputLabel into the given inputType's slot in inputField
   */
  enbs.populateInput = function(timelineEntryField, inputType, userInputEntry) {
    if (angular.isDefined(userInputEntry)) {
          userInputEntry.forEach(ta => {
            timelineEntryField.push(ta);
          });
    }
  }

  return enbs;
});
