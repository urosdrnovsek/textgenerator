/**
 * Every element of index.html the app wires up, looked up once and typed
 * by what it is (a select, an input, a button …), so the type check can
 * catch a `.value` read from the wrong kind of element. Main.js calls
 * findElements() once and hands the result to each ui/* module as `els`.
 */

/** @param {string} id */
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no #${id}`);
  return element;
}

/** @param {string} selector for the few elements without an id */
function bySelector(selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`index.html has no ${selector}`);
  return /** @type {HTMLElement} */ (element);
}

export function findElements() {
  return {
    preview: /** @type {HTMLElement} */ (byId('preview')),
    previewScroll: bySelector('.preview-scroll'),
    pageFrame: bySelector('.page-frame'),
    printSurface: /** @type {HTMLElement} */ (byId('print-surface')),
    fitIndicator: /** @type {HTMLElement} */ (byId('fit-indicator')),
    fitNotices: /** @type {HTMLElement} */ (byId('fit-notices')),
    printButton: /** @type {HTMLButtonElement} */ (byId('btn-print')),
    docxButton: /** @type {HTMLButtonElement} */ (byId('btn-docx')),
    createButton: /** @type {HTMLButtonElement} */ (byId('btn-create')),
    languageSelect: /** @type {HTMLSelectElement} */ (byId('language-select')),
    themeSelect: /** @type {HTMLSelectElement} */ (byId('theme-select')),
    levelSelect: /** @type {HTMLSelectElement} */ (byId('level-select')),
    writingModeSelect: /** @type {HTMLSelectElement} */ (byId('writing-mode-select')),
    sequenceOption: /** @type {HTMLOptionElement} */ (bySelector('#writing-mode-select option[value="sequence"]')),
    imageSlotSelect: /** @type {HTMLSelectElement} */ (byId('image-slot-select')),
    copyTargetRow: /** @type {HTMLElement} */ (byId('copy-target-row')),
    copyTargetSelect: /** @type {HTMLSelectElement} */ (byId('copy-target-select')),
    clozeControls: /** @type {HTMLElement} */ (byId('cloze-controls')),
    clozeEveryNthInput: /** @type {HTMLInputElement} */ (byId('cloze-every-nth-input')),
    clozeEveryNthButton: /** @type {HTMLButtonElement} */ (byId('btn-cloze-every-nth')),
    clozeClearButton: /** @type {HTMLButtonElement} */ (byId('btn-cloze-clear')),
    clozeWordBankToggle: /** @type {HTMLInputElement} */ (byId('cloze-word-bank-toggle')),
    answersRow: /** @type {HTMLElement} */ (byId('answers-row')),
    showAnswersToggle: /** @type {HTMLInputElement} */ (byId('show-answers-toggle')),
    questionInputs: /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('.question-input')]),
    ownTitleInput: /** @type {HTMLInputElement} */ (byId('own-title-input')),
    ownBodyInput: /** @type {HTMLTextAreaElement} */ (byId('own-body-input')),
    ownPictureToggle: /** @type {HTMLInputElement} */ (byId('own-picture-toggle')),
    ownAddButton: /** @type {HTMLButtonElement} */ (byId('btn-own-add')),
    ownDeleteButton: /** @type {HTMLButtonElement} */ (byId('btn-own-delete')),
    ownStatus: /** @type {HTMLElement} */ (byId('own-status')),
    clozeStatus: /** @type {HTMLElement} */ (byId('cloze-status')),
    previewHint: /** @type {HTMLElement} */ (byId('preview-hint')),
    candidateCount: /** @type {HTMLElement} */ (byId('candidate-count')),
    textSelect: /** @type {HTMLSelectElement} */ (byId('text-select')),
    textSelectLabel: /** @type {HTMLElement} */ (byId('text-select-label')),
    fontSelect: /** @type {HTMLSelectElement} */ (byId('font-select')),
    fontSizeInput: /** @type {HTMLInputElement} */ (byId('font-size-input')),
    lineHeightInput: /** @type {HTMLInputElement} */ (byId('line-height-input')),
    letterSpacingInput: /** @type {HTMLInputElement} */ (byId('letter-spacing-input')),
    wordSpacingInput: /** @type {HTMLInputElement} */ (byId('word-spacing-input')),
    letterColorsToggle: /** @type {HTMLInputElement} */ (byId('letter-colors-toggle')),
    graphemesInput: /** @type {HTMLInputElement} */ (byId('graphemes-input')),
    graphemesStatus: /** @type {HTMLElement} */ (byId('graphemes-status')),
    syllableColorsToggle: /** @type {HTMLInputElement} */ (byId('syllable-colors-toggle')),
    syllableSeparatorsToggle: /** @type {HTMLInputElement} */ (byId('syllable-separators-toggle')),
    syllableArcsToggle: /** @type {HTMLInputElement} */ (byId('syllable-arcs-toggle')),
    sentencePerLineToggle: /** @type {HTMLInputElement} */ (byId('sentence-per-line-toggle')),
    wordSpaceMarksToggle: /** @type {HTMLInputElement} */ (byId('word-space-marks-toggle')),
    tintSelect: /** @type {HTMLSelectElement} */ (byId('tint-select')),
    printTintToggle: /** @type {HTMLInputElement} */ (byId('print-tint-toggle')),
    lineStripesToggle: /** @type {HTMLInputElement} */ (byId('line-stripes-toggle')),
    printStripesToggle: /** @type {HTMLInputElement} */ (byId('print-stripes-toggle')),
    lineNumbersToggle: /** @type {HTMLInputElement} */ (byId('line-numbers-toggle')),
    grayscalePreviewToggle: /** @type {HTMLInputElement} */ (byId('grayscale-preview-toggle')),
    headerNameLineToggle: /** @type {HTMLInputElement} */ (byId('header-nameline-toggle')),
    headerDateToggle: /** @type {HTMLInputElement} */ (byId('header-date-toggle')),
    headerTitleToggle: /** @type {HTMLInputElement} */ (byId('header-title-toggle')),
    headerInstructionsToggle: /** @type {HTMLInputElement} */ (byId('header-instructions-toggle')),
    guideHeightInput: /** @type {HTMLInputElement} */ (byId('guide-height-input')),
    dyslexiaPresetButton: /** @type {HTMLButtonElement} */ (byId('btn-dyslexia-preset')),
    presetSelect: /** @type {HTMLSelectElement} */ (byId('preset-select')),
    loadPresetButton: /** @type {HTMLButtonElement} */ (byId('btn-load-preset')),
    deletePresetButton: /** @type {HTMLButtonElement} */ (byId('btn-delete-preset')),
    savePresetButton: /** @type {HTMLButtonElement} */ (byId('btn-save-preset')),
    storageStatus: /** @type {HTMLElement} */ (byId('storage-status')),
    imageUpload: /** @type {HTMLInputElement} */ (byId('image-upload')),
    resetImageButton: /** @type {HTMLButtonElement} */ (byId('btn-reset-image')),
    imageStatus: /** @type {HTMLElement} */ (byId('image-status')),
    packetCount: /** @type {HTMLElement} */ (byId('packet-count')),
    packetList: /** @type {HTMLElement} */ (byId('packet-list')),
    addToPacketButton: /** @type {HTMLButtonElement} */ (byId('btn-add-to-packet')),
    printPacketButton: /** @type {HTMLButtonElement} */ (byId('btn-print-packet')),
    clearPacketButton: /** @type {HTMLButtonElement} */ (byId('btn-clear-packet')),
    packetStatus: /** @type {HTMLElement} */ (byId('packet-status')),
    importJsonInput: /** @type {HTMLInputElement} */ (byId('import-json-input')),
    importImagesInput: /** @type {HTMLInputElement} */ (byId('import-images-input')),
    importContentButton: /** @type {HTMLButtonElement} */ (byId('btn-import-content')),
    importStatus: /** @type {HTMLElement} */ (byId('import-status')),
    exportSetupsButton: /** @type {HTMLButtonElement} */ (byId('btn-export-setups')),
    importSetupsInput: /** @type {HTMLInputElement} */ (byId('import-setups-input')),
    resetDataButton: /** @type {HTMLButtonElement} */ (byId('btn-reset-data'))
  };
}

/** @typedef {ReturnType<typeof findElements>} Elements */
