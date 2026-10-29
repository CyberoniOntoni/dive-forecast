/** The map's look: controls, pins, clusters, legends and the folded credits. SiteMap puts it in a style tag. */

import { CREDIT_STYLE } from "@/components/map-credit";

/** Map controls, pins and legends. */
export const MAP_STYLE = `
.dive-pin,.dive-boat{background:transparent;border:none}
.dive-map[data-dim] .dive-pin,.dive-map[data-dim] .dive-cluster{opacity:.35}
.dive-spotlight{background:transparent;border:none;pointer-events:none}
.dive-spotlight span{position:absolute;inset:0;border-radius:999px;border:3px solid var(--foam);box-shadow:0 0 0 2px var(--ink),inset 0 0 0 2px var(--ink);animation:dive-spotlight-pulse 1.1s ease-out 3}
@keyframes dive-spotlight-pulse{0%{transform:scale(.55);opacity:1}70%{transform:scale(1.35);opacity:.3}100%{transform:scale(1);opacity:.9}}
@media (prefers-reduced-motion: reduce){.dive-spotlight span{animation:none}}
.dive-map .leaflet-bar,.dive-map .leaflet-control-layers{border:1px solid color-mix(in srgb, var(--foam) 18%, transparent)!important;border-radius:14px!important;overflow:hidden;box-shadow:0 8px 24px -10px rgba(0,0,0,.6)!important}
.dive-map .leaflet-bar a{width:44px!important;height:44px!important;line-height:44px!important;background:var(--glass);backdrop-filter:blur(10px);color:var(--foam);border-bottom-color:color-mix(in srgb, var(--foam) 18%, transparent)}
.dive-map .leaflet-bar a:hover,.dive-map .leaflet-bar a:focus{background:color-mix(in srgb, var(--ink) 78%, var(--foam));color:var(--foam)}
.dive-map .leaflet-bar a:focus-visible{outline:2px solid var(--incoming);outline-offset:2px}
${CREDIT_STYLE}
.dive-map.leaflet-container{background:var(--ink)}
.dive-map .leaflet-control-layers{background:var(--glass);backdrop-filter:blur(10px);color:var(--foam)}
.dive-map .leaflet-control-layers-toggle{width:44px;height:44px;background-size:24px 24px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f5fbfc' stroke-width='1.8' stroke-linejoin='round'%3E%3Cpath d='M12 3 2 8l10 5 10-5z'/%3E%3Cpath d='m2 12 10 5 10-5'/%3E%3Cpath d='m2 16 10 5 10-5'/%3E%3C/svg%3E")}
.dive-map .leaflet-control-layers-toggle:focus-visible{outline:2px solid var(--incoming);outline-offset:2px}
.dive-map .leaflet-control-layers-expanded{padding:4px 10px 4px 8px;font:500 14px/1.2 var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif}
.dive-map .leaflet-control-layers label{min-height:44px;display:flex;align-items:center;margin:0;cursor:pointer}
.dive-map .leaflet-control-layers label>span{display:flex;align-items:center;gap:10px}
.dive-map .leaflet-control-layers input{width:18px;height:18px;margin:0;accent-color:var(--incoming)}
.dive-map .leaflet-control-layers input:focus-visible{outline:2px solid var(--incoming);outline-offset:2px}
.dive-map .leaflet-control-layers-separator{border-top-color:color-mix(in srgb, var(--foam) 28%, transparent)}
.dive-atlas-legend{background:var(--glass);backdrop-filter:blur(10px);color:var(--foam);border-radius:14px;border:1px solid color-mix(in srgb, var(--foam) 14%, transparent);box-shadow:0 8px 24px -10px rgba(0,0,0,.6);padding:6px 10px;font:500 12px/1.3 var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;max-width:190px}
.dive-atlas-legend-title{font-weight:600;margin:0 0 2px}
.dive-atlas-legend-note{margin:0 0 4px;color:color-mix(in srgb, var(--foam) 75%, transparent)}
.dive-atlas-legend ul{list-style:none;margin:0;padding:0}
.dive-atlas-legend li{display:flex;align-items:center;gap:6px;margin:2px 0}
.dive-shelter-legend{min-width:210px;max-width:240px}
.dive-shelter-time{display:flex;align-items:center;gap:6px;margin:2px 0 6px;font-variant-numeric:tabular-nums}
.dive-shelter-time>span{flex:1;text-align:center}
.dive-shelter-time button{min-width:28px;height:28px;border-radius:10px;border:1px solid color-mix(in srgb, var(--foam) 35%, transparent);background:transparent;color:var(--foam);font:600 14px/1 inherit;cursor:pointer}
.dive-shelter-time button.dive-shelter-now{padding:0 6px;font-size:12px}
.dive-shelter-time button:disabled{opacity:.35;cursor:default}
.dive-shelter-time button:focus-visible{outline:2px solid var(--incoming);outline-offset:1px}
.dive-shelter-bar{height:10px;border-radius:3px;opacity:.85}
.dive-shelter-ticks{position:relative;height:30px;margin:2px 0 2px;font-size:10px;line-height:12px}
.dive-shelter-ticks span{position:absolute;top:0;width:44px;margin-left:-1px;padding-left:3px;border-left:1px solid color-mix(in srgb, var(--foam) 60%, transparent)}
.dive-shelter-note{margin:2px 0 0}
.dive-shelter-ticks small{display:block;font-size:10px;color:color-mix(in srgb, var(--foam) 75%, transparent)}
@media (max-width:640px){.dive-shelter-legend{min-width:0;width:220px;max-width:220px}.dive-shelter-time{font-size:11px;gap:4px}.dive-shelter-time button{min-width:44px;height:44px;font-size:18px}.dive-shelter-time button.dive-shelter-now{font-size:13px}.dive-shelter-ticks{height:14px}.dive-shelter-ticks small,.dive-shelter-tick-mid,.dive-shelter-note,.dive-shelter-date{display:none}}
.dive-shelter-popup p{margin:0 0 2px}
.dive-shelter-popup-head{font-weight:600}
.dive-atlas-swatch{display:inline-block;width:12px;height:12px;border-radius:2px;flex:none}
.dive-cluster-icon{background:transparent;border:none}
.dive-cluster{width:44px;height:44px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:var(--glass);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:var(--foam);border:2px solid color-mix(in srgb, var(--incoming) 70%, transparent);box-shadow:0 1px 4px rgba(0,0,0,.45);font:600 15px/1 var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;cursor:pointer}
.dive-grid-label{color:#fff;font:600 11px/16px var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;text-shadow:0 0 3px #000,0 0 2px #000;white-space:nowrap;pointer-events:none}
`;
