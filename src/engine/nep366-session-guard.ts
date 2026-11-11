import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
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
  publicKeyHex: string;
  signatureHex: string;
}

interface Nep366RelayTrace {
  envelopeVerdict: Nep366EnvelopeRejection;
  envelopeAccepted: boolean;
  executionVerdict: {
    effectivePredecessorId: string;
    engineAccepted: boolean;
    engineRejectionCode: string | null;
  };
  outcome: StationActionOutcome;
}

export interface DelegateSessionKey {
  privateKey: Uint8Array;
  publicKeyHex: string;
}

export function createDelegateSessionKey(): DelegateSessionKey {
  const privateKey = ed25519.utils.randomSecretKey();
  return { privateKey, publicKeyHex: bytesToHex(ed25519.getPublicKey(privateKey)) };
}

type UnsignedEnvelope = Omit<Nep366DelegateEnvelope, "signatureHex" | "publicKeyHex">;

function delegatePayload(envelope: UnsignedEnvelope, action: StationAction): Uint8Array {
  const orderedAction = Object.fromEntries(
    Object.entries(action).sort(([a], [b]) => a.localeCompare(b)),
  );
  return new TextEncoder().encode(JSON.stringify([
    "afterlight-local-session-v1", envelope.senderId, envelope.receiverId,
    envelope.methodName, envelope.nonce, envelope.maxBlockHeight,
    envelope.attachedDepositYocto, orderedAction,
  ]));
}

export function signDelegateEnvelope(
  envelope: UnsignedEnvelope,
  action: StationAction,
  key: DelegateSessionKey,
): Nep366DelegateEnvelope {
  return {
    ...envelope,
    publicKeyHex: key.publicKeyHex,
    signatureHex: bytesToHex(ed25519.sign(delegatePayload(envelope, action), key.privateKey)),
  };
}

const DELEGATE_METHOD_TO_ACTION_KIND: Record<
  AllowedDelegateMethod,
  StationAction["kind"]
> = {
  set_policy: "SetPolicy",
  route_battery: "RouteBattery",
  nft_transfer: "TransferEquipmentNft",
  repair_equipment: "RepairEquipment",
  advance_turn: "AdvanceTurn",
};

export function verifyAndExecuteNep366Delegate(
  envelope: Nep366DelegateEnvelope,
  action: StationAction,
  state: Readonly<StationState>,
  trustedPublicKeyHex: string,
): Nep366RelayTrace {
  const rejectEnvelope = (verdict: Nep366EnvelopeRejection): Nep366RelayTrace => ({
    envelopeVerdict: verdict,
    envelopeAccepted: false,
    executionVerdict: {
      effectivePredecessorId: envelope.senderId,
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
    ) ||
    !Object.hasOwn(DELEGATE_METHOD_TO_ACTION_KIND, envelope.methodName) ||
    DELEGATE_METHOD_TO_ACTION_KIND[envelope.methodName as AllowedDelegateMethod] !==
      action.kind
  ) {
    return rejectEnvelope("DisallowedDelegateActionKind");
  }

  if (
    !Number.isSafeInteger(envelope.attachedDepositYocto) ||
    envelope.attachedDepositYocto !== 0
  ) {
    return rejectEnvelope("NonZeroAttachedDepositForbidden");
  }

  if (
    !Number.isSafeInteger(envelope.currentBlockHeight) ||
    !Number.isSafeInteger(envelope.maxBlockHeight) ||
    envelope.currentBlockHeight < 0 ||
    envelope.maxBlockHeight < 0 ||
    envelope.currentBlockHeight > envelope.maxBlockHeight
  ) {
    return rejectEnvelope("ExpiredMaxBlockHeight");
  }

  if (
    !Number.isSafeInteger(envelope.nonce) ||
    !Number.isSafeInteger(envelope.lastNonce) ||
    envelope.nonce < 0 ||
    envelope.lastNonce < 0 ||
    envelope.nonce <= envelope.lastNonce
  ) {
    return rejectEnvelope("StaleDelegateNonce");
  }

  try {
    if (
      envelope.publicKeyHex !== trustedPublicKeyHex ||
      !ed25519.verify(
        hexToBytes(envelope.signatureHex), delegatePayload(envelope, action),
        hexToBytes(trustedPublicKeyHex), { zip215: false },
      )
    ) {
      return rejectEnvelope("InvalidDelegateSignature");
    }
  } catch {
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
    executionVerdict: {
      effectivePredecessorId: envelope.senderId,
      engineAccepted: outcome.accepted,
      engineRejectionCode: outcome.rejectionCode,
    },
    outcome,
  };
}
