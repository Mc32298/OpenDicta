# Settings UI Redesign Spec

Date: 2026-05-14
Area: `src/windows/Settings.tsx`, `src/styles.css`, shared settings controls

## Goal

Redesign the settings window so it feels closer to macOS System Settings: calmer, more elegant, more premium, and more native to Apple desktop conventions while preserving the existing settings functionality and information architecture.

The intended tone is:

- Apple-like
- luxury through restraint
- MacBook-like materials and spacing
- refined rather than flashy

## Chosen Direction

The approved direction is:

- Visual style: `Native Frosted`
- Layout direction: `Shift toward System Settings`
- Surface treatment: `Soft frosted`

This means the redesign should stay believable as a desktop utility window, not a concept piece, and should not introduce decorative visuals that distract from the settings workflow.

## Non-Goals

- No changes to settings behavior or data flow
- No changes to AI, model, microphone, shortcut, or diagnostics logic
- No redesign of onboarding or voicebar in this task
- No migration to a new component library
- No major window architecture rewrite

## User Experience Objectives

The updated settings window should:

- feel quieter and more premium at first glance
- resemble macOS System Settings more closely than the current custom dark panel
- improve visual hierarchy so pages and groups are easier to scan
- reduce the chunky, card-stacked feel of the current interface
- preserve the current sidebar navigation pattern and tab content structure

## Layout

The current shell remains in place:

- top chrome/titlebar
- left sidebar
- right content pane

But the layout should shift toward a denser, calmer System Settings feel.

### Sidebar

The sidebar should:

- become visually lighter and more integrated with the chrome
- use tighter row spacing
- reduce the visual weight of icon containers
- use more subtle active states
- feel denser and more native, less like a custom app navigation rail

The existing tab order and navigation behavior remain unchanged.

### Main Content Pane

The content pane should:

- have more breathing room at the page level
- use stronger title hierarchy with a larger, cleaner page heading
- keep subtitles quieter and more compact
- rely more on spacing and alignment than on heavy surfaces

The page should read as a unified settings surface instead of a stack of separate dark cards.

## Material and Color

### Material Model

Use a layered frosted appearance:

- strongest blur and translucency in the top chrome and sidebar
- lighter translucency in the main pane
- subtle grouped surfaces for settings rows
- no exaggerated glass distortion

The blur should support readability, not dominate it.

### Color Palette

The palette should move toward:

- cool graphite and charcoal base tones
- subtle white separators and edge highlights
- softer text contrast
- restrained use of accent blue

The accent color should:

- remain blue
- appear quieter in resting states
- become more vivid only on focus, selection, switches, and key emphasis

Avoid:

- neon accents
- heavy purple bias
- flat monochrome slabs with no material depth

## Grouping and Rows

Settings groups should be restyled so they feel closer to macOS grouped settings panels.

### Group Containers

Groups should:

- have softer boundaries
- use lighter fills and thinner separators
- reduce obvious card framing
- feel like panels embedded in one continuous page

### Rows

Rows should:

- keep the existing label/control alignment model where practical
- gain better spacing rhythm
- feel cleaner and more precise
- avoid oversized paddings or overly strong dividing lines

## Controls

### Buttons

Buttons should:

- become quieter and more refined
- use less visual mass
- avoid oversized pill treatment except where intentionally segmented
- feel precise and desktop-native

Destructive buttons should remain clearly distinguishable but should still fit the restrained visual system.

### Toggles

Toggles should move closer to native macOS switch behavior in feel:

- cleaner track shape
- refined motion
- less heavy contrast when off

### Choice Controls

The AI preset/model/provider chips should be redesigned toward segmented-control behavior:

- slimmer
- more compact
- less like broad capsule buttons
- clearer selected state

They should still support wrapping where needed for narrow widths.

### Inputs

Text inputs should:

- feel flatter and more precise
- rely on subtle inner shading and cleaner borders
- avoid looking like generic web form controls

## Chrome and Window Header

The top chrome should feel like a quiet macOS titlebar:

- soft frosted layer
- thin bottom separation
- subdued centered title
- traffic lights integrated naturally

It should not read as a heavy app header.

## Motion

Motion should be minimal and purposeful.

Allowed motion:

- short fade or slight slide when changing pages
- subtle hover transitions
- smooth selected-state transitions
- restrained switch and control state easing

Avoid:

- floating effects
- decorative animation
- exaggerated scaling
- flashy motion used only for spectacle

## Implementation Scope

This redesign should be treated as a styling pass plus small structural refinements in the settings window.

Expected implementation work:

- refine settings shell styles
- restyle sidebar
- restyle grouped settings panels
- restyle rows, buttons, toggles, inputs, badges, and segmented-choice controls
- improve spacing and typography hierarchy
- add light page-transition polish if it can be done safely

Not expected:

- component library replacement
- functional rewrites
- backend changes

## Files in Scope

Primary:

- `src/windows/Settings.tsx`
- `src/styles.css`
- `src/ui/controls.tsx`

Possible secondary touch-ups only if needed:

- shared icon presentation in `src/ui/icons`
- small helper class updates used only by settings

## Constraints

- preserve current settings functionality
- preserve current page structure and routing
- maintain desktop readability at existing window sizes
- maintain responsive behavior for narrower widths already supported
- keep the design believable as a native-inspired desktop utility

## Verification

Implementation should be checked by:

- `npm run build`
- visual review of settings window across all tabs
- spot check of narrow-width layout behavior
- confirmation that interactive controls still behave correctly after restyling

## Open Decisions Resolved

These choices are already decided and should not be revisited during implementation unless the user explicitly asks:

- Use a System Settings-inspired direction rather than older Preferences or Apple pro-app styling
- Keep the current two-column structure, but restyle it toward System Settings
- Use soft frosted material treatment rather than mostly solid or matte surfaces
- Use the `Native Frosted` direction rather than more dramatic luxury or ultra-minimal variants

