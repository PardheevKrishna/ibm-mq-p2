// Naming convention validators inferred from the data:
//   QM:        APPQM_<APPID>      (slash → underscore, uppercase)
//   Channel:   <SRC_QM>.<DST_QM>  (SDR/RCVR pair)
//   Channel:   APP.SVRCONN.<QM>   (server-conn for app binding)
//   Transmit:  <DST_QM>.XMIT
// Existing legacy names (WL6*, WQ*, WU*) are tolerated on the source side
// but new objects created by the BCL must follow the rules above.

const TARGET_QM_RE = /^APPQM_[A-Z0-9_]{2,40}$/;
const SDR_CHANNEL_RE = /^[A-Z0-9_]+\.[A-Z0-9_]+$/;
const SVRCONN_CHANNEL_RE = /^APP\.SVRCONN\.[A-Z0-9_]+$/;
const XMIT_RE = /^[A-Z0-9_]+\.XMIT$/;

export function appIdToQm(appId: string): string {
  return "APPQM_" + appId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
}

export interface NamingResult {
  ok: boolean;
  field: string;
  message?: string;
}

export function validateTargetQmName(name: string): NamingResult {
  return TARGET_QM_RE.test(name)
    ? { ok: true, field: "qm" }
    : { ok: false, field: "qm", message: `QM name "${name}" must match APPQM_<APPID>` };
}

export function validateChannelName(name: string, kind: "SDR" | "RCVR" | "SVRCONN"): NamingResult {
  if (kind === "SVRCONN") {
    return SVRCONN_CHANNEL_RE.test(name)
      ? { ok: true, field: "channel" }
      : { ok: false, field: "channel", message: `SVRCONN channel "${name}" must match APP.SVRCONN.<QM>` };
  }
  return SDR_CHANNEL_RE.test(name)
    ? { ok: true, field: "channel" }
    : { ok: false, field: "channel", message: `Channel "${name}" must match <SRC_QM>.<DST_QM>` };
}

export function validateTransmitName(name: string): NamingResult {
  return XMIT_RE.test(name)
    ? { ok: true, field: "xmit" }
    : { ok: false, field: "xmit", message: `Transmit queue "${name}" must match <DST_QM>.XMIT` };
}
