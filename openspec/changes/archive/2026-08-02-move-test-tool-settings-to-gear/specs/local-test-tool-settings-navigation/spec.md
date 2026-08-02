## ADDED Requirements

### Requirement: Settings entry is available from the main tool view

The local test tool SHALL present a native button containing a gear icon at the top-right of the main tool view. The button MUST have the accessible name "開啟共用設定", and the decorative gear icon MUST be hidden from assistive technology.

#### Scenario: Tool opens on the main view

- **WHEN** an operator loads the local test tool
- **THEN** the main testing controls and the top-right settings button are visible
- **THEN** the shared settings form is not visible

#### Scenario: Keyboard user reaches settings

- **WHEN** a keyboard user focuses and activates the settings button
- **THEN** the shared settings view is displayed
- **THEN** focus moves to the shared settings view's return control

### Requirement: Shared settings use a dedicated in-document view

The local test tool SHALL display the existing shared settings form in a dedicated in-document settings view. The settings view SHALL provide a native return button that restores the main tool view without reloading the document.

#### Scenario: Operator opens shared settings

- **WHEN** the operator activates the gear button from the main tool view
- **THEN** the main tool view is hidden
- **THEN** a view titled "共用設定" containing every existing shared setting control and the run-all action is visible

#### Scenario: Operator returns to testing controls

- **WHEN** the operator activates the return button from the shared settings view
- **THEN** the settings view is hidden
- **THEN** the main tool view is visible
- **THEN** focus moves to the settings button

### Requirement: Navigation preserves shared setting state and testing behavior

The local test tool MUST retain each shared setting element and its current value while switching views. Navigation MUST NOT change request construction, preview, send, run-all, sequence advancement, or automatic event identifier behavior.

#### Scenario: Edited settings survive a round trip

- **WHEN** the operator edits shared setting values, returns to the main view, and opens settings again
- **THEN** every edited text, numeric, select, and checkbox value remains unchanged

#### Scenario: Requests use edited settings after returning

- **WHEN** the operator edits shared settings, returns to the main view, and previews or sends a test request
- **THEN** the existing request builder uses the edited setting values
