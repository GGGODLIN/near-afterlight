import {
  ALLOWED_DELEGATE_METHODS,
  COORDINATOR_CONTRACT_ID,
  type AllowedDelegateMethod,
} from "./constants.ts";
import {
  applyStationAction,
  type StationAction,
  type StationActionOutcome,
  type StationState,
} from "./afterlight-engine.ts";

export type Nep366EnvelopeRejection =
  | "Valid"
  | "InvalidDelegateSignature"
  | "StaleDelegateNonce"
  | "ExpiredMaxBlockHeight"
  | "WrongReceiverContract"
  | "NonZeroAttachedDepositForbidden"
  | "DisallowedDelegateActionKind";

export interface Nep366DelegateEnvelope {
  senderId: string;
  relayerSignerId: string;
  receiverId: string;
  methodName: string;
  nonce: number;
  lastNonce: number;
  maxBlockHeight: number;
  currentBlockHeight: number;
  attachedDepositYocto: number;
  signatureHex: string;
}

export interface Nep366RelayTrace {
  envelopeVerdict: Nep366EnvelopeRejection;
  envelopeAccepted: boolean;
  senderId: string;
  relayerSignerId: string;
  receiverId: string;
  nonce: number;
  lastNonce: number;
  maxBlockHeight: number;
  currentBlockHeight: number;
  executionVerdict: {
    effectivePredecessorId: string;
    relayerSignerId: string;
    engineAccepted: boolean;
    engineRejectionCode: string | null;
  };
  outcome: StationActionOutcome;
}

export function buildDeterministicDelegateSignature(
  senderId: string,
  receiverId: string,
  methodName: string,
  nonce: number,
  maxBlockHeight: number,
): string {
  return `ed25519_sig_${senderId}_${receiverId}_${methodName}_${nonce}_${maxBlockHeight}`;
}

export function verifyAndExecuteNep366Delegate(
  envelope: Nep366DelegateEnvelope,
  action: StationAction,
  state: Readonly<StationState>,
): Nep366RelayTrace {
  const rejectEnvelope = (verdict: Nep366EnvelopeRejection): Nep366RelayTrace => ({
    envelopeVerdict: verdict,
    envelopeAccepted: false,
    senderId: envelope.senderId,
    relayerSignerId: envelope.relayerSignerId,
    receiverId: envelope.receiverId,
    nonce: envelope.nonce,
    lastNonce: envelope.lastNonce,
    maxBlockHeight: envelope.maxBlockHeight,
    currentBlockHeight: envelope.currentBlockHeight,
    executionVerdict: {
      effectivePredecessorId: envelope.senderId,
      relayerSignerId: envelope.relayerSignerId,
      engineAccepted: false,
      engineRejectionCode: null,
    },
    outcome: {
      accepted: false,
      rejectionCode: null,
      state: structuredClone(state) as StationState,
      receipt: null,
    },
  });

  if (envelope.receiverId !== COORDINATOR_CONTRACT_ID) {
    return rejectEnvelope("WrongReceiverContract");
  }

  if (
    !ALLOWED_DELEGATE_METHODS.includes(
      envelope.methodName as AllowedDelegateMethod,
    )
  ) {
    return rejectEnvelope("DisallowedDelegateActionKind");
  }

  if (envelope.attachedDepositYocto !== 0) {
    return rejectEnvelope("NonZeroAttachedDepositForbidden");
  }

  if (envelope.currentBlockHeight > envelope.maxBlockHeight) {
    return rejectEnvelope("ExpiredMaxBlockHeight");
  }

  if (envelope.nonce <= envelope.lastNonce) {
    return rejectEnvelope("StaleDelegateNonce");
  }

  const expectedSignature = buildDeterministicDelegateSignature(
    envelope.senderId,
    envelope.receiverId,
    envelope.methodName,
    envelope.nonce,
    envelope.maxBlockHeight,
  );
  if (envelope.signatureHex !== expectedSignature) {
    return rejectEnvelope("InvalidDelegateSignature");
  }

  // Bind effectivePredecessorId to envelope.senderId so relayerSignerId or forged payload actorId cannot escalate privileges
  const boundAction: StationAction = {
    ...action,
    actorId: envelope.senderId,
  };

  const outcome = applyStationAction(state, boundAction);

  return {
    envelopeVerdict: "Valid",
    envelopeAccepted: true,
    senderId: envelope.senderId,
    relayerSignerId: envelope.relayerSignerId,
    receiverId: envelope.receiverId,
    nonce: envelope.nonce,
    lastNonce: envelope.lastNonce,
    maxBlockHeight: envelope.maxBlockHeight,
    currentBlockHeight: envelope.currentBlockHeight,
    executionVerdict: {
      effectivePredecessorId: envelope.senderId,
      relayerSignerId: envelope.relayerSignerId,
      engineAccepted: outcome.accepted,
      engineRejectionCode: outcome.rejectionCode,
    },
    outcome,
  };
}
