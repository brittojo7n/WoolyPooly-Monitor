const state = {
  defaultWallet: (document.body && document.body.dataset.defaultWallet) || '',
  sseSource: null,
  chart: null,
  tooltip: null,
  graphData: null,
  ticker: 'VTC',
  usdPrice: 0,
  graphMax: 0.0001,
  hoveredIndex: -1,
  touchPinned: -1,
  lastTipIdx: -1,
  payloadKey: null,
  workers: { page: 1, pageSize: 5, data: [] },
  payments: { page: 1, pageSize: 5, data: [] },
  elCache: new Map(),
  chartDirty: false,
  infoTip: null,
  tipTimer: null,
  tipBtn: null,
  tipShownAt: 0,
  tipPositionPending: false,
  walletCopyTimer: null
};

export default state;
