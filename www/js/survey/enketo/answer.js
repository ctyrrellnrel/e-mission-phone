angular.module('emission.survey.enketo.answer', [
  'ionic',
  'emission.config.dynamic',
])
.factory('EnketoSurveyAnswer', function(
  $http, DynamicConfig, $translate, $translateMessageFormatInterpolation
) {
  /**
   * @typedef EnketoAnswerData
   * @type {object}
   * @property {string} label - display label (this value is use for displaying on the button)
   * @property {string} ts - the timestamp at which the survey was filled out (in seconds)
   * @property {string} fmt_time - the formatted timestamp at which the survey was filled out
   * @property {string} name - survey name
   * @property {string} version - survey version
   * @property {string} xmlResponse - survey answer XML string
   * @property {string} jsonDocResponse - survey answer JSON object
   */

  /**
   * @typedef EnketoAnswer
   * @type {object}
   * @property {EnketoAnswerData} data - answer data
   * @property {{[labelField:string]: string}} [labels] - virtual labels (populated by populateLabels method)
   */

  /**
   * @typedef EnketoSurveyConfig
   * @type {{
   *  [surveyName:string]: {
   *   formPath: string;
   *   labelFields: string[];
   *   version: number;
   *   compatibleWith: number;
   *  }
   * }}
   */

  const LABEL_FUNCTIONS = {
    UseLabelTemplate: (xmlDoc, name) => {

      return _lazyLoadConfig().then(configSurveys => {

        const config = configSurveys[name]; // config for this survey
        const lang = $translate.use();
        const labelTemplate = config.labelTemplate?.[lang];

        if (!labelTemplate) return "Answered"; // no template given in config
        if (!config.labelVars) return labelTemplate; // if no vars given, nothing to interpolate,
        // so we return the unaltered template

        // gather vars that will be interpolated into the template according to the survey config
        const labelVars = {}
        for (lblVar in config.labelVars) {
          const fieldName = config.labelVars[lblVar].key;
          let fieldStr = _getAnswerByTagName(xmlDoc, fieldName);
          if (fieldStr == '<null>') fieldStr = null;
          if (config.labelVars[lblVar].type == 'length') {
            const fieldMatches = fieldStr?.split(' ');
            labelVars[lblVar] = fieldMatches?.length || 0;
          } else {
            throw new Error(`labelVar type ${config.labelVars[lblVar].type } is not supported!`)
          }
        }

        const label = $translateMessageFormatInterpolation.interpolate(labelTemplate, labelVars);
        return label.replace(/^[ ,]+|[ ,]+$/g, ''); // trim leading and trailing spaces and commas
      })
    }
  };
  
  /** @type {EnketoSurveyConfig} _config */
  let _config;

  /**
   * _getAnswerByTagName lookup for the survey answer by tag name form the given XML document.
   * @param {XMLDocument} xmlDoc survey answer object
   * @param {string} tagName tag name
   * @returns {string} answer string. If not found, return "\<null\>"
   */
  function _getAnswerByTagName(xmlDoc, tagName) {
    const vals = xmlDoc.getElementsByTagName(tagName);
    const val = vals.length ? vals[0].innerHTML : null;
    if (!val) return '<null>';
    return val;
  }

  /**
   * _lazyLoadConfig load enketo survey config. If already loaded, return the cached config
   * @returns {Promise<EnketoSurveyConfig>} enketo survey config
   */
  function _lazyLoadConfig() {
    if (_config !== undefined) {
      return Promise.resolve(_config);
    }
    return DynamicConfig.configReady().then((newConfig) => {
      Logger.log("Resolved UI_CONFIG_READY promise in answer.js, filling in templates");
      _config = newConfig.survey_info.surveys;
      return _config;
    })
  }

  /**
   * filterByNameAndVersion filter the survey answers by survey name and their version.
   * The version for filtering is specified in enketo survey `compatibleWith` config.
   * The stored survey answer version must be greater than or equal to `compatibleWith` to be included.
   * @param {string} name survey name (defined in enketo survey config)
   * @param {EnketoAnswer[]} answers survey answers
   *  (usually retrieved by calling UnifiedDataLoader.getUnifiedMessagesForInterval('manual/survey_response', tq)) method.
   * @return {Promise<EnketoAnswer[]>} filtered survey answers
   */
  function filterByNameAndVersion(name, answers) {
    return _lazyLoadConfig().then(config =>
      answers.filter(answer =>
        answer.data.name === name &&
        answer.data.version >= config[name].compatibleWith
      )
    );
  }

  /**
   * resolve answer label for the survey
   * @param {string} name survey name
   * @param {XMLDocument} xmlDoc survey answer object
   * @returns {Promise<string>} label string Promise
   */
  function resolveLabel(name, xmlDoc) {
    // Some studies may want a custom label function for their survey.
    // Those can be added in LABEL_FUNCTIONS with the survey name as the key.
    // Otherwise, UseLabelTemplate will create a label using the template in the config
    if (LABEL_FUNCTIONS[name])
      return LABEL_FUNCTIONS[name](xmlDoc);
    return LABEL_FUNCTIONS.UseLabelTemplate(xmlDoc, name);
  }

  /**
   * resolve timestamps label from the survey response
   * @param {XMLDocument} xmlDoc survey answer object
   * @param {object} trip trip object
   * @returns {object} object with `start_ts` and `end_ts`
   *    - null if no timestamps are resolved
   *    - undefined if the timestamps are invalid
   */
  function resolveTimestamps(xmlDoc, timelineEntry) {
    // check for Date and Time fields
    const startDate = xmlDoc.getElementsByTagName('Start_date')?.[0]?.innerHTML;
    const startTime = xmlDoc.getElementsByTagName('Start_time')?.[0]?.innerHTML;
    const endDate = xmlDoc.getElementsByTagName('End_date')?.[0]?.innerHTML;
    const endTime = xmlDoc.getElementsByTagName('End_time')?.[0]?.innerHTML;

    // if any of the fields are missing, return null
    if (!startDate || !startTime || !endDate || !endTime) return null; 

    let additionStartTs = moment(startDate + 'T' + startTime).unix();
    let additionEndTs = moment(endDate + 'T' + endTime).unix();

    if (additionStartTs > additionEndTs) {
      return undefined; // if the start time is after the end time, this is an invalid response
    }

    /* Enketo survey time inputs are only precise to the minute, while trips/places are precise to
      the millisecond. To avoid precision issues, we will check if the start/end timestamps from
      the survey response are within the same minute as the start/end or enter/exit timestamps.
      If so, we will use the exact trip/place timestamps */
    const entryStartTs = timelineEntry.start_ts || timelineEntry.enter_ts;
    const entryEndTs = timelineEntry.end_ts || timelineEntry.exit_ts;
    if (additionStartTs - (additionStartTs % 60) == entryStartTs - (entryStartTs % 60))
      additionStartTs = entryStartTs;
    if (additionEndTs - (additionEndTs % 60) == entryEndTs - (entryEndTs % 60))
      additionEndTs = entryEndTs;

    // return unix timestamps in seconds
    return {
      start_ts: additionStartTs,
      end_ts: additionEndTs
    }; 
  }

  return {
    filterByNameAndVersion,
    resolveLabel,
    resolveTimestamps,
  };
});
