## MODIFIED Requirements

### Requirement: Session termination

The app SHALL terminate Firebase Authentication state on sign-out, stop registered protected-data subscriptions, and redirect to `/sign-in`. The sign-out control SHALL be presented in the account section of the settings page.

#### Scenario: Sign out a member

- **WHEN** a signed-in member selects sign out
- **THEN** the Firebase session ends, protected subscriptions stop, and protected routes become inaccessible

#### Scenario: Reach sign out from settings

- **WHEN** a signed-in member opens the settings page
- **THEN** the account section SHALL present a sign-out control that terminates the session when activated
