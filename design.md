# DarkForge UI Design System

## Color Palette

### Backgrounds
- **Primary BG**: `#0D0D12` — deep navy-black, main app background
- **Surface**: `#16161F` — elevated cards, table cells, input areas
- **Surface Border**: `#252530` — subtle borders on cards and containers
- **Surface Hover**: `#1E1E2A` — cell/row highlight on tap

### Accent
- **Accent**: `#00D68F` — primary action color (buttons, active tab, success states)
- **Accent Dim**: `#008055` — secondary accent (subtitles, inactive icons)
- **Accent Glow**: `#00D68F` at 15% opacity — status pill backgrounds, subtle highlights

### Text
- **Primary Text**: `#E0E0E8` — headings, file names, main content
- **Dim Text**: `#70708` — path labels, secondary info
- **Muted Text**: `#50505C` — status bar, timestamps
- **Log Text**: `#8AD4B0` — console output default color
- **Phase Text**: `#00E6A0` — phase completion markers in console

### Semantic
- **Success**: `#00FF9D` — exploit success messages
- **Error**: `#FF5C5C` — failure messages, error states
- **Warning/Running**: `#FFCC00` — in-progress status dot & text
- **Dir Icon**: `#60CAFF` — folder icons in file manager (blue tint)
- **File Icon**: `#80808C` — file doc icons (neutral gray)
- **Chevron**: `#40404C` — navigation chevrons

### Tab Bar
- **Background**: matches Primary BG `#0D0D12`
- **Selected**: Accent `#00D68F`
- **Unselected**: `#40404C`

## Typography

| Element | Font | Size | Weight |
|---------|------|------|--------|
| Page title | System (SF Pro) | 28 | Bold |
| Subtitle | Monospace | 13 | Medium |
| Button label | System | 16 | Bold |
| Toolbar button | System | 13 | Semibold |
| Console log | Monospace | 12 | Regular |
| File name | System | 15 | Medium |
| File size | Monospace | 11 | Regular |
| Path label | Monospace | 13 | Regular |
| Status pill | Monospace | 11 | Semibold |
| Status bar | Monospace | 11 | Medium |
| Tab label | System | 10 | Semibold/Medium |

## Component Specs

### Cards
- Corner radius: **14px** (main cards), **10px** (smaller cards like path bar)
- Border: 1px `Surface Border`
- Background: `Surface`

### Buttons (Primary)
- Corner radius: **12px**
- Background: `Accent`
- Text: Black
- SF Symbol icon + text
- Height: **50px**
- Disabled state: `#252530` bg, `Dim Text` color

### Toolbar Buttons
- Corner radius: **10px**
- Background: `Surface`
- Border: 1px `Surface Border`
- Text: `Primary Text`
- SF Symbol icon (12pt semibold) + label
- Height: **40px**
- Equal width distribution

### Status Pill
- Corner radius: **12px**
- Height: **24px**
- 8px colored dot + label
- States:
  - Ready/Success: Accent color, accent glow bg
  - Running: Yellow `#FFCC00`, yellow glow bg
  - Failed: Error red, red glow bg

### Console Log Card
- Card with 32px header bar (`#1C1C26` bg)
- Header label: "Console Output" in `Dim Text`
- Log body: 12px monospace, `Log Text` color
- Content inset: 12px all sides

### File List Table
- Inside a card container
- Row height: **48px**
- Separator: 1px `#1E1E28`, inset 52px from left
- Directory rows: folder.fill icon (blue), name, chevron.right
- File rows: doc.fill icon (gray), name, size label, no chevron
- Selection: `Surface Hover` background

### Path Bar
- Card style, 40px height
- folder.fill icon (accent dim) + monospace path text
- Truncate middle for long paths

## Layout

- Safe area respected on all edges
- Horizontal padding: **16-20px**
- Vertical spacing between sections: **12-16px**
- Header top margin: **16px** from safe area

## SF Symbols Used

| Context | Symbol |
|---------|--------|
| Exploit tab | `bolt.fill` |
| Files tab | `folder.fill` |
| Home button | `house.fill` |
| Up button | `arrow.up` |
| Refresh button | `arrow.clockwise` |
| Directory icon | `folder.fill` |
| File icon | `doc.fill` |
| Row chevron | `chevron.right` |
| Path bar icon | `folder.fill` |
| Run exploit btn | `bolt.fill` |
