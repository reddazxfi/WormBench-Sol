import React, { createContext, useContext } from 'react';
import type { PxlLibrary } from '../types/pxl';

export type PxlPickerAccept = 'image' | 'sound';

export interface PxlPickerRequest {
  accept: PxlPickerAccept;
  /** Optional title shown in the picker header (e.g. "Pick Hold Sheet"). */
  label?: string;
  onPick: (file: File, framesHint?: number) => void;
}

export interface PxlActiveScope {
  libraryKey: string;
  weaponName: string;
  artNames: string[];
  soundNames: string[];
}

export interface PxlLibraryContextValue {
  libraries: PxlLibrary[];
  activeScope?: PxlActiveScope;
  openPicker: (req: PxlPickerRequest) => void;
  openLibraryModal: () => void;
}

const NOOP_CONTEXT: PxlLibraryContextValue = {
  libraries: [],
  openPicker: () => {},
  openLibraryModal: () => {},
};

export const PxlLibraryContext = createContext<PxlLibraryContextValue>(NOOP_CONTEXT);

export function usePxlLibrary(): PxlLibraryContextValue {
  return useContext(PxlLibraryContext);
}
