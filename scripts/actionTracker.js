const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

const MODULE_ID = 'pf2e-manual-action-tracker';

let tracker, positionX, positionY, rendered = false;

/**
 * Initialize settings on game load
 */
Hooks.once('init', function() {
    registerSettings();
})

/**
 * Load the tracker
 */
Hooks.on('ready', function() {
    ActionTracker.loadTracker();
})

/**
 * Show the tracker when token selected
 */
Hooks.on('controlToken', function() {
    if (!game.settings.get(MODULE_ID, 'enabled')) return;
    ActionTracker.checkRender();
})

/**
 * Check for conditions and usage of actions changing to reload tracker
 */
Hooks.on('updateActor', function(actor) {
    if (!game.settings.get(MODULE_ID, 'enabled')) return;
    if (canvas.tokens.controlled.length === 1 && ActionTracker.token.actor.id === actor.id) tracker.render();
})

/**
 * Reset everyone's actions to used on combat start
 */
Hooks.on('combatStart', async function(encounter) {
    if (game.user.id !== game.users.activeGM.id || !game.settings.get(MODULE_ID, 'enabled')) return;

    for (const combatant of encounter.combatants) {
        if (combatant.actorId === encounter.turns[0].actorId) continue;
        await ActionTracker.resetTracker({ token: combatant.token, allUsed: true });
    }
    ActionTracker.checkRender();
})

/**
 * Reset current actor's actions to unused when turn starts, account for conditions
 */
Hooks.on('pf2e.startTurn', async function(combatant, encounter) {
    if (game.user.id !== game.users.activeGM.id || !game.settings.get(MODULE_ID, 'enabled')) return;
    await ActionTracker.resetTracker({ token: combatant.token });
})

/**
 * Process end of combat for the tracker
 */
Hooks.on('deleteCombat', function() {
    if (!game.settings.get(MODULE_ID, 'outOfCombat')) tracker.close();
    else setTimeout(() => ActionTracker.checkRender(), 100);
})

/**
 * Check for conditions being added
 */
Hooks.on('applyTokenStatusEffect', (token, status) => {
    if (token.actor.inCombat || !['stunned', 'slowed', 'quickened'].includes(status) || ActionTracker.token?.id !== token.id) return;
    setTimeout(() => ActionTracker.checkRender(), 100);
})

/**
 * Check for condition badges being updated
 */
Hooks.on('updateItem', (item) => {
    if (item.actor.inCombat || !['stunned', 'slowed', 'quickened'].includes(item.slug) || ActionTracker.token?.actor.id !== item.actor.id) return;
    ActionTracker.checkRender();
})

/**
 * Check for items granting conditions inMemoryOnly
 */
Hooks.on('createItem', (item) => {
    if (item.actor.inCombat || item.type !== 'effect' || ActionTracker.token?.actor.id !== item.actor.id) return;
    ActionTracker.checkRender();
})

/**
 * Check for removal of effects granting conditions
 */
Hooks.on('deleteItem', (item) => {
    if (item.actor.inCombat || item.type !== 'effect' || ActionTracker.token?.actor.id !== item.actor.id) return;
    ActionTracker.checkRender();
})

/**
 * Defines the Action Tracker which shows actions used in an AppV2 window on the canvas
 */
class ActionTracker extends HandlebarsApplicationMixin(ApplicationV2) {
    static actionsData;
    static token;
    static shiftDown = false; // holds if shift is being held down when window re-renders

    static DEFAULT_OPTIONS = {
        id: 'tracker',
        background: 'none',
        window: {
            icon: 'fas fa-arrows-up-down-left-right',
            title: 'tracker'
        },
        actions: {
            addAction: ActionTracker.addAction,
            removeAction: ActionTracker.removeAction,
            useAction: { handler: ActionTracker.useAction, buttons: [0,2] } // left and right click handling
        }
    }

    static PARTS = {
        tracker: {
          template: 'modules/pf2e-manual-action-tracker/templates/tracker.hbs'
        }
    }

    /** @override */
    async _prepareContext(options) {
        const context = { };
        
        ActionTracker.actionsData = ActionTracker.token.actor.getFlag(MODULE_ID, 'actions');

        // Set defaults for actors that haven't been initialized
        if (!ActionTracker.actionsData) {
            ActionTracker.actionsData = {
                actionMax: 3,
                actionUsed: 0,
                reactionMax: 1,
                reactionUsed: 0,
                quickenedUsed: 0,
                quickened: 0,
                slowed: 0,
                stunned: 0
            }
            ActionTracker.updateActor();
        }

        let quickened, slowed, stunned;

        // Find the values of the conditions important to be tracked. When in combat, we want only the stored values from the start of turn. Out of combat, update immediately.
        if (ActionTracker.token.actor.inCombat) {
            ({ quickened, slowed, stunned } = ActionTracker.actionsData);
        }
        else {
            quickened = ActionTracker.token.actor.conditions.contents.some(o => o.slug === 'quickened') ? 1 : 0;
            slowed = ActionTracker.token.actor.conditions.contents.find(o => o.slug === 'slowed')?.system.value.value ?? 0;
            stunned = ActionTracker.token.actor.conditions.contents.find(o => o.slug === 'stunned')?.system.value.value ?? 0;
        }

        context.actionArray = [];
        context.reactionArray = [];

        // Calculate actions locked and gained
        let totalActions = ActionTracker.actionsData.actionMax + quickened;
        let normalActions = totalActions - quickened;
        let totalStun = Math.min(stunned, totalActions);
        let stillStunned = stunned > totalActions;
        let totalSlow = totalStun >= totalActions ? 0 : totalStun === 0 ? Math.min(totalActions, slowed) : Math.min(totalActions - totalStun, Math.max(slowed - stunned, 0));
        let actionsLeft = Math.max(totalActions - totalSlow - totalStun, 0);
        let quickenedLost = false;

        // Lock actions from stun
        for (let i = 0; i < totalStun; i++) {
            context.actionArray.push({ used: true, stun: true, quickened: (quickened > 0 && !quickenedLost) });
            if (!quickenedLost) quickenedLost = true;
        }

        // Lock actions from slow
        for (let i = 0; i < totalSlow; i++) {
            context.actionArray.push({ used: true, slow: true, quickened: (quickened > 0 && !quickenedLost) });
            if (!quickenedLost) quickenedLost = true;
        }

        // Add normal actions, tracking if they've been used or not
        for (let i = 0; i < ((!!totalSlow || !!totalStun) ? actionsLeft : normalActions); i++) {
            if (i < ActionTracker.actionsData.actionUsed) context.actionArray.push({ used: true });
            else context.actionArray.push({ used: stillStunned });
        }

        // Add quickened action if not previously locked
        if (actionsLeft > normalActions) {
            for (let i = 0; i < quickened; i++) {
                if (i < ActionTracker.actionsData.quickenedUsed) context.actionArray.push({ used: true, quickened: true });
                else context.actionArray.push({ used: false, quickened: true });
            }
        }
        
        // Add reactions
        for (let i = 0; i < ActionTracker.actionsData.reactionMax; i++) {
            if (i < ActionTracker.actionsData.reactionUsed || stillStunned) context.reactionArray.push({ used: true, stun: stillStunned });
            else context.reactionArray.push({ used: false });
        }

        context.shiftDown = ActionTracker.shiftDown; // to show remove button instead of add
        context.name = ActionTracker.token.name;
        context.tokenNameSetting = game.settings.get(MODULE_ID, 'tokenName');
        return context;
    }
    
    /**
     * Saves position of tracker to user setting once movement has stopped
     */
    static savePosition = foundry.utils.debounce(() => {
        game.user.setFlag(MODULE_ID, 'position', { x: tracker.position.left, y: tracker.position.top });
    }, 100);

    /** @override */
    _onPosition(position) {
        super._onPosition(position);
        ActionTracker.savePosition(position);
    }

    /**
     * Checks to make sure only have 1 token selected to show tracker for that actor. Displays based on settings.
     */
    static checkRender = foundry.utils.debounce(() => {
        if (canvas.tokens.controlled.length === 1) {
            if (!canvas.tokens.controlled[0].actor || (!canvas.tokens.controlled[0].actor.inCombat && !game.settings.get(MODULE_ID, 'outOfCombat'))) return;
            if (!rendered) {
                tracker.render({ force: true, position: { left: positionX, top: positionY } });
                rendered = true;
            }
            else {
                tracker.render({ force: true });
            }
        }
        else {
            tracker.close({ animate: false });
        }
    }, 100);
    
    /** @override */
    render(options) {
        ActionTracker.token = canvas.tokens.controlled[0];
        super.render(options);
    }

    /**
     * Initializes tracker position for first load. Top left corner of canvas if no saved position.
     */
    static loadTracker() {
        if (!game.settings.get(MODULE_ID, 'enabled')) return;
        
        if (!game.user.getFlag(MODULE_ID, 'position')) {
            positionX = 150;
            positionY = 65;
            game.user.setFlag(MODULE_ID, 'position', { left: positionX, top: positionY });
        }
        else {
            let position = game.user.getFlag(MODULE_ID, 'position');
            positionX = position.x;
            positionY = position.y;
        }
        tracker = new ActionTracker();
    }

    /**
     * Saves action counts to the actor
     * 
     * @returns Promise
     */
    static async updateActor() {
        return await ActionTracker.token.actor.setFlag(MODULE_ID, 'actions', ActionTracker.actionsData);
    }

    /**
     * Adds 1 to the count of used actions or reactions if left clicked one that is unused.
     * Removes 1 from the count of used actions or reactions if right clicked one that is used.
     * Does nothing if left clicking a used or right clicking an unused or clicking an action locked by stun or slow.
     * Saves usage to the actor.
     * 
     * @param {Object} event the event of clicking the div
     */
    static async useAction(event) {
        const { button, target } = event;
        const usable = target.classList.contains('usable');
        const leftClick = button === 0;

        if ((leftClick && !usable) || (!leftClick && usable)) return;

        if (target.dataset.type === 'action') {
            for (const condition of ['stun', 'slow']) {
                if (target.classList.contains(condition)) return;
            }
            if (target.classList.contains('quickened')) ActionTracker.actionsData.quickenedUsed += (leftClick ? 1 : -1);
            else ActionTracker.actionsData.actionUsed += (leftClick ? 1 : -1);
        }
        else if (target.dataset.type === 'reaction') {
            ActionTracker.actionsData.reactionUsed += (leftClick ? 1 : -1);
        }

        await ActionTracker.updateActor();
    }

    /**
     * Adds 1 to max actions or reactions if clicked on the add div and save to the actor.
     * 
     * @param {Object} event the event of clicking the div
     */
    static async addAction(event) {
        const { target } = event;
        const targetName = target.attributes.name.value;
        if (targetName === 'tracker-add-action') {
            ActionTracker.actionsData.actionMax += 1;
        }
        else if (targetName === 'tracker-add-reaction') {
            ActionTracker.actionsData.reactionMax += 1;
        }
        await ActionTracker.updateActor();
    }

    /**
     * While holding shift, removes 1 from max actions or reaction (minimum 3 actions and 1 reacon) if clicked on the add div and save to the actor.
     * 
     * @param {Object} event the event of clicking the div
     */
    static async removeAction(event) {
        const { target } = event;
        const targetName = target.attributes.name.value;
        if (targetName === 'tracker-add-action') {
            if (ActionTracker.actionsData.actionMax === 3) return ui.notifications.warn('Already at minimum of 3 actions');
            ActionTracker.actionsData.actionMax -= 1;
            ActionTracker.actionsData.actionUsed = Math.min(ActionTracker.actionsData.actionUsed, ActionTracker.actionsData.actionMax);
        }
        else if (targetName === 'tracker-add-reaction') {
            if (ActionTracker.actionsData.reactionMax === 1) return ui.notifications.warn('Already at minimum of 1 reaction');
            ActionTracker.actionsData.reactionMax -= 1;
            ActionTracker.actionsData.reactionUsed = Math.min(ActionTracker.actionsData.reactionUsed, ActionTracker.actionsData.reactionMax);
        }
        await ActionTracker.updateActor();
    }

    /** @override */
    close(options) {
        $(document).off('keydown.pf2e-manual-action-tracker.tracker').off('keyup.pf2e-manual-action-tracker.tracker'); // turn off listeners
        super.close(options);
    }

    /** @override */
    _onRender(context, options) {
        // Add listeners for holding shift down and adjust add/remove buttons accordingly
        for (const eventType of ['keydown.pf2e-manual-action-tracker.tracker', 'keyup.pf2e-manual-action-tracker.tracker']) {
            $(document).off(eventType);
            $(document).on(eventType, (event) => {
                const { originalEvent } = event;
                if (!(originalEvent instanceof KeyboardEvent) || originalEvent.repeat || !(originalEvent.shiftKey || ActionTracker.shiftDown)) return;
                
                ActionTracker.shiftDown = event.type === 'keydown';
                const addActionButton = this.element.querySelectorAll('div[name*=tracker-add]');
                
                for (const button of addActionButton) {
                    button.innerHTML = ActionTracker.shiftDown ? `<i class="fas fa-minus"></i>${ button.classList.contains('reactionPip') ? 'R' : '1' }` : `<i class="fas fa-plus"></i>${ button.classList.contains('reactionPip') ? 'R' : '1' }`;
                    button.dataset.action = ActionTracker.shiftDown ? 'removeAction' : 'addAction';   
                }
            })
        }
    }

    /**
     * Resets the tracker for start of turn in combat. Stores the condition values form start of turn and resets action/reaction usage. Saves to the actor.
     * 
     * @param {Object} options  Function context
     */
    static async resetTracker(options = { }) {
        const actor = options.token?.actor;
        if (!actor) return;

        // Initializes defaults for actors if non-existent
        const actionData = options.token.actor.getFlag(MODULE_ID, 'actions') ?? {
            actionMax: 3,
            actionUsed: 0,
            reactionMax: 1,
            reactionUsed: 0,
            quickenedUsed: 0,
            quickened: 0,
            slowed: 0,
            stunned: 0
        };

        // Stores current condition values and resets action count to 0 on turn start
        if (actor.inCombat) {
            const quickened = actor.conditions.contents.some(o => o.slug === 'quickened') ? 1 : 0;
            const slowed = actor.conditions.contents.find(o => o.slug === 'slowed')?.system.value.value ?? 0;
            const stunned = actor.conditions.contents.find(o => o.slug === 'stunned')?.system.value.value ?? 0;

            actionData.quickened = quickened;
            actionData.slowed = slowed;
            actionData.stunned = stunned;
            actionData.actionUsed = options.allUsed ? actionData.actionMax : 0;
            actionData.reactionUsed = options.allUsed ? actionData.reactionMax : 0;
            actionData.quickenedUsed = options.allUsed ? actionData.quickened : 0;
        }

        await actor.setFlag(MODULE_ID, 'actions', actionData);
    }
}

/**
 * Register the settings to Foundry
 */
export const registerSettings = function () {
    // Show the tracker or not
    game.settings.register(MODULE_ID, 'enabled', {
        name: 'Enabled',
        hint: 'Client setting to use the action tracker',
        default: true,
        scope: 'client',
        type: Boolean,
        config: true,
        onChange: value => {
            if (value) {
                ActionTracker.loadTracker();
                ActionTracker.checkRender();
            }
            else {
                rendered = false;
                tracker.close();
                tracker = null;
            }
        }
    });

    // Show always or only in combat
    game.settings.register(MODULE_ID, 'outOfCombat', {
        name: 'Show While Out of Combat',
        hint: 'Client setting to show the tracker while out of combat. Will update condition usage each actor update instead of each round.',
        default: false,
        scope: 'client',
        type: Boolean,
        config: true,
        onChange: value => {
            if (!value) tracker?.close()
            else if (!!tracker) ActionTracker.checkRender();
        }
    });

    // Options for showing token name on tracker
    game.settings.register(MODULE_ID, 'tokenName', {
        name: 'Token Name on Tracker',
        default: 'hover',
        scope: 'client',
        type: String,
        config: true,
        choices: {
            'none': 'Never',
            'hover': 'On Hover',
            'always': 'Always'
        },
        onChange: value => {
            ActionTracker.checkRender();
        }
    });
  };