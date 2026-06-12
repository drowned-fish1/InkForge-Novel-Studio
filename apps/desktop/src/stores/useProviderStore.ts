import { create } from "zustand";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";
import type { ProviderConfigInput, ProviderStatus } from "@/types/app";

interface ProviderState {
  providerStatus?: ProviderStatus;
  saveProviderConfig: (input: ProviderConfigInput) => Promise<void>;
  loadProviderStatus: () => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set) => ({
  saveProviderConfig: async (input) => {
    set({ providerStatus: await bridge.saveProviderConfig(input) });
    useProjectStore.setState({ error: undefined });
  },
  loadProviderStatus: async () => {
    set({ providerStatus: await bridge.providerStatus() });
  }
}));
