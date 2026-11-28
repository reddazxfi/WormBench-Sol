import { useEffect, useMemo, useState } from 'react';
import { Blocks, ListOrdered, Orbit, Sparkles, Stamp, Volume2, Zap } from 'lucide-react';
import type { WeaponProject } from '../types/weapon';
import {
  CustomSoundsCard,
  ExplosionEffectCard,
  RibbonTrailCard,
  supportsExplosionEffect,
  supportsExplosionSound,
  supportsIntervalSound,
  supportsLaunchSound,
  supportsRibbonTrail,
} from './EffectsCards';
import { EmitterCard } from './EmitterCard';
import { FireSequenceCard } from './FireSequenceCard';
import { supportsEmitter } from '../data/emitter';
import { TerrainStampCard } from './TerrainStampCard';
import { supportsFireSequence } from '../data/fireSequence';
import { supportsTerrainStamp } from '../data/terrainStamp';

interface Props {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

type EffectTabId = 'trail' | 'explosion' | 'emitter' | 'sounds' | 'sequence' | 'stamp';

interface EffectTabDef {
  id: EffectTabId;
  label: string;
  hint: string;
  icon: typeof Zap;
  active: boolean;
}

export const EffectsWorkspace: React.FC<Props> = ({ project, onChange }) => {
  const [selectedTab, setSelectedTab] = useState<EffectTabId>('trail');

  const tabs = useMemo<EffectTabDef[]>(() => {
    const list: EffectTabDef[] = [];
    if (supportsRibbonTrail(project)) {
      list.push({
        id: 'trail',
        label: 'Ribbon Trail',
        hint: 'Additive beam + glow ribbon following flying projectiles',
        icon: Zap,
        active: !!project.ribbonTrail?.enabled,
      });
    }
    if (supportsExplosionEffect(project)) {
      list.push({
        id: 'explosion',
        label: 'Explosion Burst',
        hint: 'Custom shockwave ring, lens flare & optional smoke cloud',
        icon: Sparkles,
        active: !!project.explosionEffect?.enabled,
      });
    }
    if (supportsEmitter(project)) {
      list.push({
        id: 'emitter',
        label: 'Emitter',
        hint: 'PX effect manager that rides the muzzle or the fired round: ring, bolts, sparks, ribbon',
        icon: Orbit,
        active: !!project.emitter?.enabled,
      });
    }
    if (
      supportsLaunchSound(project) ||
      supportsExplosionSound(project) ||
      supportsIntervalSound(project)
    ) {
      list.push({
        id: 'sounds',
        label: 'Custom Sounds',
        hint: 'Import PCM WAV audio for the launch, detonations and in-flight loops',
        icon: Volume2,
        active: !!(
          project.customSounds?.launchEnabled ||
          project.customSounds?.explosionEnabled ||
          project.customSounds?.intervalEnabled
        ),
      });
    }
    if (supportsTerrainStamp(project)) {
      list.push({
        id: 'stamp',
        label: 'Terrain Stamp',
        hint: 'Burn the round’s picture into the land where it bursts (wa.land.stamp)',
        icon: Stamp,
        active: !!project.terrainStamp?.enabled,
      });
    }
    if (supportsFireSequence(project)) {
      list.push({
        id: 'sequence',
        label: 'Firing & Burst',
        hint: 'Native gun payload launcher or custom lockstep sequencer (wfws.sdk)',
        icon: ListOrdered,
        active: !!project.fireSequence?.enabled,
      });
    }
    return list;
  }, [project]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === selectedTab)) {
      setSelectedTab(tabs[0].id);
    }
  }, [tabs, selectedTab]);

  const currentTab = tabs.some((t) => t.id === selectedTab) ? selectedTab : tabs[0]?.id;

  return (
    <section
      aria-label="Effects & Libraries Workbench"
      className="overflow-hidden rounded-xl border border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-900"
    >
      {tabs.length === 0 ? (
        <div className="space-y-2 p-8 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-stone-400" aria-hidden="true" />
          <div className="font-heading text-sm font-semibold text-stone-800 dark:text-stone-200">
            No Library Hooks Active for Native Air Strikes
          </div>
          <p className="mx-auto max-w-lg text-xs text-stone-500 dark:text-stone-400">
            Native WA air strike bombs spawn directly from the flyover aircraft rather than a worm
            slot. Enable <strong className="font-semibold text-stone-700 dark:text-stone-200">Lua Airstrike Takeover</strong> with a{' '}
            <strong className="font-semibold text-stone-700 dark:text-stone-200">Missile</strong> payload on the Weapon Record page to attach ribbon
            trails, explosion bursts, emitters, terrain stamps, and custom detonation WAVs.
          </p>
        </div>
      ) : (
        <>
          {/* Unified Armory Effects Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 bg-stone-50/70 px-3 dark:border-stone-800 dark:bg-stone-950/50">
            <div
              className="flex flex-wrap items-center gap-1"
              role="tablist"
              aria-label="Effects and library modules"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isSelected = currentTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    title={tab.hint}
                    onClick={() => setSelectedTab(tab.id)}
                    className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'text-stone-950 dark:text-white'
                        : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isSelected
                          ? 'text-forge-600 dark:text-forge-400'
                          : 'text-stone-400 dark:text-stone-500'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{tab.label}</span>
                    {tab.active && (
                      <span className="font-mono text-[10px] font-medium text-forge-600 dark:text-forge-400">
                        · on
                      </span>
                    )}
                    {isSelected && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-forge-600 dark:bg-forge-400"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {currentTab === 'trail' && <RibbonTrailCard project={project} onChange={onChange} />}
            {currentTab === 'explosion' && <ExplosionEffectCard project={project} onChange={onChange} />}
            {currentTab === 'emitter' && <EmitterCard project={project} onChange={onChange} />}
            {currentTab === 'sounds' && <CustomSoundsCard project={project} onChange={onChange} />}
            {currentTab === 'sequence' && <FireSequenceCard project={project} onChange={onChange} />}
            {currentTab === 'stamp' && <TerrainStampCard project={project} onChange={onChange} />}
          </div>
        </>
      )}

      {/* Compact Dependency Reminder Footer */}
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200/80 bg-stone-50/60 px-4 py-2 text-[11px] text-stone-500 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-400">
        <Blocks className="h-3.5 w-3.5 shrink-0 text-stone-400 dark:text-stone-500" aria-hidden="true" />
        <span>
          Enabling any library automatically adds its dependency to <code className="font-mono">mod.toml</code>. Add extra third-party library IDs under <strong className="font-semibold text-stone-700 dark:text-stone-300">Bundle &amp; Export</strong>.
        </span>
      </div>
    </section>
  );
};
