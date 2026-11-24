// Vite-resolved URLs for the shared beam & glow textures shipped once inside
// `wfws.sdk` (`wf-lib/wfws/sprites/`) and used by the live 50 Hz `BeamPreview`
// canvas. Kept separate from `beam.ts` so `beam.ts`, `luaGenerator.ts`, and
// `packExporter.ts` remain free of Vite imports.
import type { BeamArtStyle, BeamSpriteRole } from '../types/weapon';
import beamCoreUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam.png';
import beamGlowUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_glow.png';
import beamEndUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_glow_endpoint.png';
import beamOrbUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_orb.png';
import beamSoftUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_soft.png';
import beamGlowSoftUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_glow_soft.png';
import beamEndSoftUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_end_soft.png';
import beamOrbSoftUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_orb_soft.png';
import beamPlasmaUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_plasma.png';
import beamGlowPlasmaUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_glow_plasma.png';
import beamEndPlasmaUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_end_plasma.png';
import beamOrbPlasmaUrl from '../../spec/lua_sdk/wfws_sdk/sprites/beam_orb_plasma.png';
import wormIdleUrl from '../../spec/worms/idle.png';
import wormHurtUrl from '../../spec/worms/hurt.png';

export const BEAM_CORE_URL: string = beamCoreUrl;
export const BEAM_GLOW_URL: string = beamGlowUrl;
/** The glow sheet with one soft end, used as the cap at both ends of the beam. */
export const BEAM_END_URL: string = beamEndUrl;
export const BEAM_ORB_URL: string = beamOrbUrl;

export const BEAM_ART_STYLE_URLS: Record<BeamArtStyle, Record<BeamSpriteRole, string>> = {
  classic: {
    core: beamCoreUrl,
    glow: beamGlowUrl,
    end: beamEndUrl,
    orb: beamOrbUrl,
  },
  soft: {
    core: beamSoftUrl,
    glow: beamGlowSoftUrl,
    end: beamEndSoftUrl,
    orb: beamOrbSoftUrl,
  },
  plasma: {
    core: beamPlasmaUrl,
    glow: beamGlowPlasmaUrl,
    end: beamEndPlasmaUrl,
    orb: beamOrbPlasmaUrl,
  },
};

export const WORM_IDLE_URL: string = wormIdleUrl;
export const WORM_HURT_URL: string = wormHurtUrl;
