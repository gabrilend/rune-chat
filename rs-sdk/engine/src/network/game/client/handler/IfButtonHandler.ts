import Component from '#/cache/config/Component.js';
import Player from '#/engine/entity/Player.js';
import ScriptProvider from '#/engine/script/ScriptProvider.js';
import ScriptRunner from '#/engine/script/ScriptRunner.js';
import ScriptState from '#/engine/script/ScriptState.js';
import ServerTriggerType from '#/engine/script/ServerTriggerType.js';
import ClientGameMessageHandler from '#/network/game/client/ClientGameMessageHandler.js';
import IfButton from '#/network/game/client/model/IfButton.js';
import Environment from '#/util/Environment.js';

export default class IfButtonHandler extends ClientGameMessageHandler<IfButton> {
    handle(message: IfButton, player: Player): boolean {
        const { component: comId } = message;

        const com = Component.get(comId);
        if (typeof com === 'undefined' || !player.isComponentVisible(com)) {
            return false;
        }

        player.lastCom = comId;

        if (player.resumeButtons.indexOf(player.lastCom) !== -1) {
            if (player.activeScript && player.activeScript.execution === ScriptState.PAUSEBUTTON) {
                player.executeScript(player.activeScript, true, true);
            }
        } else {
            const root = Component.get(com.rootLayer);

            // side interfaces (tabs) are treated as modals for now, giving
            // their button scripts protected access so p_finduid can use the
            // fast-path that bypasses canAccess().
            const isTab = player.tabs.indexOf(com.rootLayer) !== -1;
            const protect = isTab || root.overlay == false;

            const script = ScriptProvider.getByTriggerSpecific(ServerTriggerType.IF_BUTTON, comId, -1);
            if (script) {
                console.log(`[DEBUG IfButton] com=${com.comName} isTab=${isTab} overlay=${root.overlay} protect=${protect} player.protect=${player.protect} player.delayed=${player.delayed} player.run=${player.run}`);
                player.executeScript(ScriptRunner.init(script, player), protect);
                console.log(`[DEBUG IfButton] after execute: player.run=${player.run}`);
            } else {
                console.log(`[DEBUG IfButton] NO SCRIPT for com=${com.comName} comId=${comId}`);
                if (Environment.NODE_DEBUG) {
                    player.messageGame(`No trigger for [if_button,${com.comName}]`);
                }
            }
        }

        return true;
    }
}
