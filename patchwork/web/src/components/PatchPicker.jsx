import { rotatePatch } from '../data/patches.js';
import PatchShape from './PatchShape.jsx';

// Every one of the 33 real patches, always shown (per the MVP scope -
// see docs/patchwork-next-steps.md - "present every possible piece").
// Only the patches in `pickableDomain` (the current player's actual
// selectPatch domain from the server, App.jsx's legalActions - see
// engine.js's queryLegalActions and patchCircle.js) are clickable -
// everything else is disabled, whether it's already taken, still
// elsewhere in the circle waiting its turn, or just unaffordable.
// Never recomputed from raw pool/cost data here - "Client Authority:
// Zero". `patches` comes from the server (App.jsx's loadPatches())
// rather than a static import, so it starts empty until that fetch
// resolves - renders no tiles yet rather than erroring.
export default function PatchPicker({ patches, pickableDomain, selectedPatchId, onSelect, disabled }) {
  const pickable = new Set(pickableDomain);

  return (
    <div id="patchPicker" className="patch-picker">
      {patches.map((patch) => {
        const isPickable = pickable.has(patch.id);
        const isSelected = patch.id === selectedPatchId;
        return (
          <button
            key={patch.id}
            className={['patch-tile', isSelected && 'selected'].filter(Boolean).join(' ')}
            disabled={disabled || !isPickable || isSelected}
            onClick={() => onSelect(patch.id)}
            title={patch.id}
            data-patch-id={patch.id}
          >
            <PatchShape shape={rotatePatch(patch, 0)} cost={patch.cost} time={patch.time} size={8} />
          </button>
        );
      })}
    </div>
  );
}
