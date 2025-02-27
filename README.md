# PF2e Manual Action Tracker
## Installation

https://github.com/websterguy/pf2e-manual-action-tracker/releases/latest/download/module.json

## Description

This mod provides a manual action tracker on the canvas.

What's the manual part?

- The module does not and never will track actions used when an action/strike/spell is posted to chat.
- You can add as many actions to track above 3 and as many reactions above 1 as you desire. Tracking and action count is unique per actor.

What's automated?

- The module adds an extra action when quickened.
- The module locks out actions when slowed and/or stunned. The extra action from quickened will be locked out first with the assumption that it has the least versatility and would be desired to be lost first.
  - When stunned at start of turn and removing the number of available actions from the stunned count still leaves the actor stunned, reactions are set as used/unavailable.
  - If the turn starts with both slowed and stunned, and there are actions left over after stunned count has been used up, slowed is applied to remaining actions after taking the stunned into account.
  - Stunned count is **not** removed from the condition counter when applied to lock out actions.
- The module sets all actions and reactions as used/unavailable on combat start and resets actions and reactions on turn start.

## Donations

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Y8Y5TH8DM)
