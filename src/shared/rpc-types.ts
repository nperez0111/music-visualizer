// Shared RPC schema between bun (`src/bun/index.ts`) and the controls webview
// (`src/mainview/index.ts`). Both sides must agree on this exact shape;
// keeping the single source here prevents drift.

export type CaptureStatus =
	| "idle"
	| "starting"
	| "capturing"
	| "permission-denied"
	| "binary-missing"
	| "error";

export type AudioSource = "system" | "mic";

export type PackParameter =
	| { type: "float"; name: string; label?: string; min: number; max: number; default: number }
	| { type: "int"; name: string; label?: string; min: number; max: number; default: number }
	| { type: "bool"; name: string; label?: string; default: boolean }
	| { type: "enum"; name: string; label?: string; options: string[]; default: string }
	| { type: "color"; name: string; label?: string; default: [number, number, number] }
	| { type: "range"; name: string; label?: string; min: number; max: number; default: [number, number] }
	| { type: "vec2"; name: string; label?: string; default: [number, number] }
	| { type: "vec3"; name: string; label?: string; default: [number, number, number] }
	| { type: "vec4"; name: string; label?: string; default: [number, number, number, number] };

export type ParamValue = number | boolean | string | number[];
export type ParamValueMap = Record<string, ParamValue>;

export type PackPreset = { name: string; values: ParamValueMap };

export type PackInfo = {
	id: string;
	name: string;
	version: string;
	author?: string;
	description?: string;
	source: "builtin" | "user";
	parameters: PackParameter[];
	parameterValues: ParamValueMap;
	presets: PackPreset[];
	/**
	 * True when the pack's WASM runtime tripped its frame-deadline watchdog
	 * (or otherwise self-terminated) and the pack is no longer producing
	 * uniforms. UI should render the pack as disabled.
	 */
	runtimeBroken?: boolean;
};

export type AutoSettings = { enabled: boolean; seconds: number; shuffle: boolean };

export type ControlsRPC = {
	bun: {
		requests: {
			getInitialState: {
				params: {};
				response: {
					collapsed: boolean;
					audioStatus: CaptureStatus;
					audioSource: AudioSource;
					packs: PackInfo[];
					activePackId: string;
					auto: AutoSettings;
				};
			};
			getControlsPosition: { params: {}; response: { x: number; y: number } };
			listPacks: { params: {}; response: { packs: PackInfo[]; activePackId: string } };
			importPack: {
				params: {};
				response: { ok: boolean; id?: string; error?: string };
			};
			importPackBytes: {
				params: { fileName: string; bytesB64: string };
				response: { ok: boolean; id?: string; error?: string };
			};
		};
		messages: {
			setCollapsed: { collapsed: boolean };
			setControlsPosition: { x: number; y: number };
			setActivePack: { id: string };
			removePack: { id: string };
			setPackParameter: { packId: string; name: string; value: ParamValue };
			applyPreset: { packId: string; presetName: string };
			setAudioSource: { source: AudioSource };
			openScreenCapturePrefs: {};
			nextPack: {};
			setAutoSettings: { enabled: boolean; seconds: number; shuffle: boolean };
		};
	};
	webview: {
		requests: {};
		messages: {
			audioStatus: { status: CaptureStatus; detail?: string };
			audioSourceChanged: { source: AudioSource };
			audioLevel: { rms: number; peak: number };
			activePackChanged: { id: string };
			packsChanged: { packs: PackInfo[]; activePackId: string };
			collapsedChanged: { collapsed: boolean };
			renderError: { message: string };
		};
	};
};
