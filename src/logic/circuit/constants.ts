// Shared geometry/layout constants for the circuit diagram pipeline.
// Kept dependency-free so every other circuit module can import them without cycles.

export const ffWidth = 126;
export const ffHeight = 124;
export const obstaclePadding = 12;
export const routingChannelY = 34;
export const routingChannelX = 20;
export const channelStep = 24;
export const feedbackLaneStep = 24;

/** Named X columns (and a few helper lanes) that define the left→right circuit zones. */
export const zone = {
  inputX: 56,
  inputNotX: 132,
  busStartX: 230,
  busTrackStep: 30,
  productX: 470,
  sumX: 650,
  outputX: 824,
  ffX: 880,
  feedbackBusX: 1062,
  gateToGateLaneX: 608,
  ffApproachX: 812,
};

export const layoutTop = 220;
export const targetSlotSpacing = 118;
export const srTargetSlotSpacing = 148;
export const productTermSpacing = 96;
export const srProductTermSpacing = 116;
export const feedbackTopY = 48;
export const clockGap = 88;
