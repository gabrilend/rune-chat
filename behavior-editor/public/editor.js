// editor.js - Canvas-based node graph editor for behavior profiles
//
// Vanilla JS, no dependencies. Uses requestAnimationFrame render loop with
// camera transform for pan/zoom. Nodes are states, edges are transitions.
// Supports typed data ports and data connections for passing values between states.

(() => {
'use strict';

// ============ Constants ============
const NODE_W = 180;
const NODE_BASE_H = 70;
const NODE_HEADER_H = 22;
const NODE_RADIUS = 6;
const PORT_RADIUS = 7;
const DATA_PORT_RADIUS = 5;
const PORT_SPACING = 20;
const PORT_AREA_TOP = 42;  // below header (22) + behavior text line (20)
const GRID_SIZE = 20;
const ARROW_SIZE = 10;
const AUTO_SAVE_DELAY = 2000;

const PORT_TYPE_COLORS = {
    player:   '#2ecc71',
    number:   '#4a9eff',
    item:     '#e67e22',
    location: '#9b59b6',
    text:     '#999999',
};

const PORT_VALUE_TYPES = ['player', 'number', 'item', 'location', 'text'];

const INTERRUPT_TYPES = [
    'dm', 'nearby_chat', 'combat', 'player_interaction', 'low_health', 'timer_complete'
];

const CONDITION_TYPES = [
    'behavior_complete', 'timer', 'inventory_percent_full', 'health_percent',
    'item_count', 'skill_level', 'always'
];

const DEFAULT_COLORS = ['#4a9eff', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];

// ============ State ============
let profile = createEmptyProfile();
let behaviors = [];
let interruptPriorities = {};
let selectedNodeId = null;
let selectedTransitionId = null;
let selectedConnectionId = null;
let camera = { x: 0, y: 0, zoom: 1 };

// Interaction state
let dragging = null;              // { nodeId, offsetX, offsetY }
let panning = false;
let panStart = { x: 0, y: 0 };
let drawingTransition = null;     // { fromNodeId, worldX, worldY }
let drawingDataConnection = null; // { fromStateId, fromPortId, valueType, worldX, worldY }

// Undo/Redo
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;

// Auto-save
let autoSaveTimer = null;
let isDirty = false;

// DOM refs
const canvas = document.getElementById('editor-canvas');
const ctx = canvas.getContext('2d');
const contextMenu = document.getElementById('context-menu');
let contextMenuTarget = null; // { type: 'node'|'transition'|'connection'|'canvas', id?, x?, y? }

// ============ Profile Helpers ============

function createEmptyProfile() {
    return {
        id: '',
        name: 'Untitled Profile',
        description: '',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        initialStateId: '',
        states: [],
        transitions: [],
        dataConnections: [],
        editorMeta: { canvasOffsetX: 0, canvasOffsetY: 0, zoom: 1 },
    };
}

function genId() {
    return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2, 10);
}

function getState(id) {
    return profile.states.find(s => s.id === id);
}

function getTransition(id) {
    return profile.transitions.find(t => t.id === id);
}

function getDataConnection(id) {
    return (profile.dataConnections || []).find(c => c.id === id);
}

function getOutgoingTransitions(stateId) {
    return profile.transitions
        .filter(t => t.fromStateId === stateId)
        .sort((a, b) => b.priority - a.priority);
}

// ============ Node Height & Port Positioning ============

function getNodeHeight(state) {
    const ports = state.ports || [];
    const inputCount = ports.filter(p => p.side === 'input').length;
    const outputCount = ports.filter(p => p.side === 'output').length;
    const maxPorts = Math.max(inputCount, outputCount);
    if (maxPorts === 0) return NODE_BASE_H;
    return Math.max(NODE_BASE_H, PORT_AREA_TOP + maxPorts * PORT_SPACING + 10);
}

function getTransitionOutputPos(node) {
    // Transition port: right edge at header level
    return { x: node.x + NODE_W, y: node.y + NODE_HEADER_H / 2 };
}

function getTransitionInputPos(node) {
    // Transition input: left edge at header level
    return { x: node.x, y: node.y + NODE_HEADER_H / 2 };
}

// Legacy aliases used by transition drawing
function getNodePortPos(node) { return getTransitionOutputPos(node); }
function getNodeInputPos(node) { return getTransitionInputPos(node); }

function getDataPortPos(state, port) {
    const ports = (state.ports || []).filter(p => p.side === port.side);
    const index = ports.findIndex(p => p.id === port.id);
    if (index < 0) return null;
    const y = state.y + PORT_AREA_TOP + index * PORT_SPACING;
    const x = port.side === 'input' ? state.x : state.x + NODE_W;
    return { x, y };
}

function getDataPortPosById(state, portId) {
    const port = (state.ports || []).find(p => p.id === portId);
    if (!port) return null;
    return getDataPortPos(state, port);
}

// ============ Undo/Redo ============

function pushUndo() {
    undoStack.push(JSON.stringify(profile));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    markDirty();
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(profile));
    profile = JSON.parse(undoStack.pop());
    syncEditorMeta();
    clearSelection();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(profile));
    profile = JSON.parse(redoStack.pop());
    syncEditorMeta();
    clearSelection();
}

function syncEditorMeta() {
    camera.x = profile.editorMeta.canvasOffsetX;
    camera.y = profile.editorMeta.canvasOffsetY;
    camera.zoom = profile.editorMeta.zoom;
    document.getElementById('profile-name').value = profile.name;
}

// ============ Auto-save ============

function markDirty() {
    isDirty = true;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(autoSave, AUTO_SAVE_DELAY);
}

async function autoSave() {
    if (!isDirty || !profile.id) return;
    isDirty = false;
    profile.updatedAt = new Date().toISOString();
    profile.editorMeta = { canvasOffsetX: camera.x, canvasOffsetY: camera.y, zoom: camera.zoom };
    try {
        await fetch(`/api/profiles/${profile.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profile),
        });
    } catch (e) {
        console.error('Auto-save failed:', e);
        showToast('Auto-save failed', 'error');
    }
}

// ============ Canvas Helpers ============

function resizeCanvas() {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
}

function screenToWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    const cx = sx - rect.left;
    const cy = sy - rect.top;
    return {
        x: (cx - camera.x) / camera.zoom,
        y: (cy - camera.y) / camera.zoom,
    };
}

function worldToScreen(wx, wy) {
    return {
        x: wx * camera.zoom + camera.x,
        y: wy * camera.zoom + camera.y,
    };
}

// ============ Hit Testing ============

function hitTestNode(wx, wy) {
    for (let i = profile.states.length - 1; i >= 0; i--) {
        const s = profile.states[i];
        const h = getNodeHeight(s);
        if (wx >= s.x && wx <= s.x + NODE_W && wy >= s.y && wy <= s.y + h) {
            return s.id;
        }
    }
    return null;
}

function hitTestPort(wx, wy) {
    // Test transition output ports (header level)
    for (const s of profile.states) {
        const p = getTransitionOutputPos(s);
        const dx = wx - p.x;
        const dy = wy - p.y;
        if (dx * dx + dy * dy <= (PORT_RADIUS + 4) * (PORT_RADIUS + 4)) {
            return s.id;
        }
    }
    return null;
}

function hitTestDataPort(wx, wy) {
    // Returns { stateId, portId, port } or null
    for (const state of profile.states) {
        for (const port of (state.ports || [])) {
            const pos = getDataPortPos(state, port);
            if (!pos) continue;
            const dx = wx - pos.x;
            const dy = wy - pos.y;
            if (dx * dx + dy * dy <= (DATA_PORT_RADIUS + 5) * (DATA_PORT_RADIUS + 5)) {
                return { stateId: state.id, portId: port.id, port };
            }
        }
    }
    return null;
}

function hitTestTransition(wx, wy) {
    const threshold = 8;
    for (const t of profile.transitions) {
        const from = getState(t.fromStateId);
        const to = getState(t.toStateId);
        if (!from || !to) continue;

        const p0 = getNodePortPos(from);
        const p3 = getNodeInputPos(to);
        const cp = Math.abs(p3.x - p0.x) * 0.5 + 40;
        const p1 = { x: p0.x + cp, y: p0.y };
        const p2 = { x: p3.x - cp, y: p3.y };

        for (let i = 0; i <= 20; i++) {
            const t_ = i / 20;
            const bx = bezierPoint(p0.x, p1.x, p2.x, p3.x, t_);
            const by = bezierPoint(p0.y, p1.y, p2.y, p3.y, t_);
            const dx = wx - bx;
            const dy = wy - by;
            if (dx * dx + dy * dy < threshold * threshold) {
                return t.id;
            }
        }
    }
    return null;
}

function hitTestDataConnection(wx, wy) {
    const threshold = 8;
    for (const conn of (profile.dataConnections || [])) {
        const fromState = getState(conn.fromStateId);
        const toState = getState(conn.toStateId);
        if (!fromState || !toState) continue;

        const p0 = getDataPortPosById(fromState, conn.fromPortId);
        const p3 = getDataPortPosById(toState, conn.toPortId);
        if (!p0 || !p3) continue;

        const cp = Math.abs(p3.x - p0.x) * 0.4 + 30;
        const p1 = { x: p0.x + cp, y: p0.y };
        const p2 = { x: p3.x - cp, y: p3.y };

        for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            const bx = bezierPoint(p0.x, p1.x, p2.x, p3.x, t);
            const by = bezierPoint(p0.y, p1.y, p2.y, p3.y, t);
            const dx = wx - bx;
            const dy = wy - by;
            if (dx * dx + dy * dy < threshold * threshold) {
                return conn.id;
            }
        }
    }
    return null;
}

function bezierPoint(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3;
}

// ============ Rendering ============

function render() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    drawGrid(w, h);
    drawTransitions();
    drawDataConnections();
    drawDrawingTransition();
    drawDrawingDataConnection();
    drawNodes();

    ctx.restore();

    document.getElementById('zoom-display').textContent = Math.round(camera.zoom * 100) + '%';
    requestAnimationFrame(render);
}

function drawGrid(w, h) {
    const gridSize = GRID_SIZE;
    const startX = Math.floor(-camera.x / camera.zoom / gridSize) * gridSize;
    const startY = Math.floor(-camera.y / camera.zoom / gridSize) * gridSize;
    const endX = startX + w / camera.zoom + gridSize * 2;
    const endY = startY + h / camera.zoom + gridSize * 2;

    ctx.strokeStyle = '#1a1a3e';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = startX; x < endX; x += gridSize) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += gridSize) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }
    ctx.stroke();
}

function drawNodes() {
    for (const state of profile.states) {
        const isSelected = state.id === selectedNodeId;
        const isInitial = state.id === profile.initialStateId;
        const color = state.color || '#4a9eff';
        const nodeH = getNodeHeight(state);

        // Shadow
        ctx.shadowColor = isSelected ? color : 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = isSelected ? 12 : 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;

        // Body
        ctx.fillStyle = '#1e2a4a';
        ctx.strokeStyle = isSelected ? color : '#2a3a5a';
        ctx.lineWidth = isSelected ? 2 : 1;
        roundRect(ctx, state.x, state.y, NODE_W, nodeH, NODE_RADIUS);
        ctx.fill();
        ctx.stroke();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Header bar
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(state.x + NODE_RADIUS, state.y);
        ctx.lineTo(state.x + NODE_W - NODE_RADIUS, state.y);
        ctx.arcTo(state.x + NODE_W, state.y, state.x + NODE_W, state.y + NODE_RADIUS, NODE_RADIUS);
        ctx.lineTo(state.x + NODE_W, state.y + NODE_HEADER_H);
        ctx.lineTo(state.x, state.y + NODE_HEADER_H);
        ctx.lineTo(state.x, state.y + NODE_RADIUS);
        ctx.arcTo(state.x, state.y, state.x + NODE_RADIUS, state.y, NODE_RADIUS);
        ctx.closePath();
        ctx.fill();

        // Initial state indicator
        if (isInitial) {
            ctx.fillStyle = '#2ecc71';
            ctx.beginPath();
            ctx.arc(state.x + 12, state.y + NODE_HEADER_H / 2, 5, 0, Math.PI * 2);
            ctx.fill();

            const pulse = (Math.sin(Date.now() / 400) + 1) / 2;
            ctx.strokeStyle = `rgba(46, 204, 113, ${0.3 + pulse * 0.4})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(state.x + 12, state.y + NODE_HEADER_H / 2, 5 + pulse * 4, 0, Math.PI * 2);
            ctx.stroke();
        }

        // State name (in header)
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textBaseline = 'middle';
        const nameX = isInitial ? state.x + 22 : state.x + 8;
        ctx.fillText(truncateText(state.name || 'Untitled', NODE_W - (isInitial ? 30 : 16)), nameX, state.y + NODE_HEADER_H / 2);

        // Behavior name (in body, below header)
        ctx.fillStyle = '#999';
        ctx.font = '11px sans-serif';
        ctx.fillText(truncateText(state.behaviorName || 'none', NODE_W - 16), state.x + 8, state.y + NODE_HEADER_H + 14);

        // Interrupt count badge
        const intCount = (state.interruptHandlers || []).filter(h => h.action !== 'ignore').length;
        if (intCount > 0) {
            ctx.fillStyle = '#e74c3c';
            ctx.beginPath();
            ctx.arc(state.x + NODE_W - 14, state.y + NODE_HEADER_H + 14, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(intCount, state.x + NODE_W - 14, state.y + NODE_HEADER_H + 15);
            ctx.textAlign = 'left';
        }

        // Transition output port (header level, right side)
        const tPort = getTransitionOutputPos(state);
        ctx.fillStyle = '#4a9eff';
        ctx.strokeStyle = '#1e2a4a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tPort.x, tPort.y, PORT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Data ports
        const ports = state.ports || [];
        const inputPorts = ports.filter(p => p.side === 'input');
        const outputPorts = ports.filter(p => p.side === 'output');

        for (const port of inputPorts) {
            const pos = getDataPortPos(state, port);
            if (!pos) continue;
            const pColor = PORT_TYPE_COLORS[port.valueType] || '#666';

            ctx.fillStyle = pColor;
            ctx.strokeStyle = '#1e2a4a';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, DATA_PORT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Label (inside node, right of port)
            ctx.fillStyle = '#ccc';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(truncateText(port.name, 65), pos.x + DATA_PORT_RADIUS + 4, pos.y);
        }

        for (const port of outputPorts) {
            const pos = getDataPortPos(state, port);
            if (!pos) continue;
            const pColor = PORT_TYPE_COLORS[port.valueType] || '#666';

            ctx.fillStyle = pColor;
            ctx.strokeStyle = '#1e2a4a';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, DATA_PORT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Label (inside node, left of port)
            ctx.fillStyle = '#ccc';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(truncateText(port.name, 65), pos.x - DATA_PORT_RADIUS - 4, pos.y);
        }

        // Reset text alignment
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

function drawTransitions() {
    for (const t of profile.transitions) {
        const from = getState(t.fromStateId);
        const to = getState(t.toStateId);
        if (!from || !to) continue;

        const isSelected = t.id === selectedTransitionId;
        const p0 = getNodePortPos(from);
        const p3 = getNodeInputPos(to);

        const cp = Math.abs(p3.x - p0.x) * 0.5 + 40;
        const p1 = { x: p0.x + cp, y: p0.y };
        const p2 = { x: p3.x - cp, y: p3.y };

        ctx.strokeStyle = isSelected ? '#f39c12' : '#4a6a8a';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        ctx.stroke();

        // Arrow at end
        const t_ = 0.95;
        const tx = bezierPoint(p0.x, p1.x, p2.x, p3.x, t_);
        const ty = bezierPoint(p0.y, p1.y, p2.y, p3.y, t_);
        const angle = Math.atan2(p3.y - ty, p3.x - tx);

        ctx.fillStyle = isSelected ? '#f39c12' : '#4a6a8a';
        ctx.beginPath();
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(p3.x - ARROW_SIZE * Math.cos(angle - 0.4), p3.y - ARROW_SIZE * Math.sin(angle - 0.4));
        ctx.lineTo(p3.x - ARROW_SIZE * Math.cos(angle + 0.4), p3.y - ARROW_SIZE * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();

        // Label at midpoint
        const label = t.label || conditionLabel(t.condition);
        if (label) {
            const mx = bezierPoint(p0.x, p1.x, p2.x, p3.x, 0.5);
            const my = bezierPoint(p0.y, p1.y, p2.y, p3.y, 0.5);

            ctx.font = '10px sans-serif';
            const metrics = ctx.measureText(label);
            const pad = 4;

            ctx.fillStyle = 'rgba(22, 33, 62, 0.9)';
            ctx.fillRect(mx - metrics.width / 2 - pad, my - 7 - pad, metrics.width + pad * 2, 14 + pad * 2);

            ctx.fillStyle = isSelected ? '#f39c12' : '#8ab4f8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, mx, my);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
    }
}

function drawDataConnections() {
    const connections = profile.dataConnections || [];
    for (const conn of connections) {
        const fromState = getState(conn.fromStateId);
        const toState = getState(conn.toStateId);
        if (!fromState || !toState) continue;

        const p0 = getDataPortPosById(fromState, conn.fromPortId);
        const p3 = getDataPortPosById(toState, conn.toPortId);
        if (!p0 || !p3) continue;

        const fromPort = (fromState.ports || []).find(p => p.id === conn.fromPortId);
        const color = fromPort ? (PORT_TYPE_COLORS[fromPort.valueType] || '#666') : '#666';
        const isSelected = conn.id === selectedConnectionId;

        const cp = Math.abs(p3.x - p0.x) * 0.4 + 30;
        const p1 = { x: p0.x + cp, y: p0.y };
        const p2 = { x: p3.x - cp, y: p3.y };

        ctx.strokeStyle = isSelected ? '#fff' : color;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.globalAlpha = isSelected ? 1.0 : 0.7;
        ctx.setLineDash([4, 3]);

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
    }
}

function drawDrawingTransition() {
    if (!drawingTransition) return;
    const from = getState(drawingTransition.fromNodeId);
    if (!from) return;

    const p0 = getNodePortPos(from);
    const p3 = { x: drawingTransition.worldX, y: drawingTransition.worldY };

    const cp = Math.abs(p3.x - p0.x) * 0.5 + 40;
    const p1 = { x: p0.x + cp, y: p0.y };
    const p2 = { x: p3.x - cp, y: p3.y };

    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawDrawingDataConnection() {
    if (!drawingDataConnection) return;
    const fromState = getState(drawingDataConnection.fromStateId);
    if (!fromState) return;

    const p0 = getDataPortPosById(fromState, drawingDataConnection.fromPortId);
    if (!p0) return;

    const p3 = { x: drawingDataConnection.worldX, y: drawingDataConnection.worldY };
    const color = PORT_TYPE_COLORS[drawingDataConnection.valueType] || '#666';

    const cp = Math.abs(p3.x - p0.x) * 0.4 + 30;
    const p1 = { x: p0.x + cp, y: p0.y };
    const p2 = { x: p3.x - cp, y: p3.y };

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;
}

function conditionLabel(cond) {
    if (!cond) return '';
    switch (cond.type) {
        case 'behavior_complete': return 'complete';
        case 'timer': return (cond.durationMs / 1000) + 's';
        case 'inventory_percent_full': return `inv ${cond.operator} ${cond.value}%`;
        case 'health_percent': return `hp ${cond.operator} ${cond.value}%`;
        case 'item_count': return `${cond.itemPattern} ${cond.operator} ${cond.value}`;
        case 'skill_level': return `${cond.skillName} ${cond.operator} ${cond.value}`;
        case 'always': return 'always';
        default: return cond.type;
    }
}

function truncateText(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    while (text.length > 0 && ctx.measureText(text + '...').width > maxWidth) {
        text = text.slice(0, -1);
    }
    return text + '...';
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// ============ Selection & Panels ============

function clearSelection() {
    selectedNodeId = null;
    selectedTransitionId = null;
    selectedConnectionId = null;
    document.getElementById('state-panel').style.display = 'none';
    document.getElementById('transition-panel').style.display = 'none';
    document.getElementById('panel-placeholder').style.display = 'block';
}

function selectNode(nodeId) {
    selectedNodeId = nodeId;
    selectedTransitionId = null;
    selectedConnectionId = null;
    document.getElementById('panel-placeholder').style.display = 'none';
    document.getElementById('transition-panel').style.display = 'none';
    document.getElementById('state-panel').style.display = 'block';
    populateStatePanel(nodeId);
}

function selectTransition(transId) {
    selectedTransitionId = transId;
    selectedNodeId = null;
    selectedConnectionId = null;
    document.getElementById('panel-placeholder').style.display = 'none';
    document.getElementById('state-panel').style.display = 'none';
    document.getElementById('transition-panel').style.display = 'block';
    populateTransitionPanel(transId);
}

function selectDataConnection(connId) {
    selectedConnectionId = connId;
    selectedNodeId = null;
    selectedTransitionId = null;
    // No dedicated panel -- just highlight the connection on canvas
    document.getElementById('state-panel').style.display = 'none';
    document.getElementById('transition-panel').style.display = 'none';
    document.getElementById('panel-placeholder').style.display = 'block';
}

function populateStatePanel(nodeId) {
    const state = getState(nodeId);
    if (!state) return;

    document.getElementById('state-name').value = state.name;
    document.getElementById('state-color').value = state.color || '#4a9eff';

    // Behavior dropdown
    const behaviorSelect = document.getElementById('state-behavior');
    behaviorSelect.innerHTML = '<option value="">-- Select Behavior --</option>';
    for (const b of behaviors) {
        const opt = document.createElement('option');
        opt.value = b.name;
        opt.textContent = b.name;
        if (b.name === state.behaviorName) opt.selected = true;
        behaviorSelect.appendChild(opt);
    }

    updateBehaviorDescription(state.behaviorName);
    updateBehaviorParams(state);
    updateInterruptHandlers(state);
    updatePortsList(state);
}

function updateBehaviorDescription(behaviorName) {
    const info = behaviors.find(b => b.name === behaviorName);
    document.getElementById('behavior-description').textContent = info ? info.description : '';
}

function updateBehaviorParams(state) {
    const container = document.getElementById('behavior-params');
    container.innerHTML = '';
    const info = behaviors.find(b => b.name === state.behaviorName);
    if (!info || !info.params.length) return;

    const inputPorts = (state.ports || []).filter(p => p.side === 'input');

    for (const param of info.params) {
        const row = document.createElement('div');
        row.className = 'param-row';
        const currentVal = state.behaviorParams?.[param.name] ?? param.default;
        const existingBinding = (state.paramBindings || []).find(b => b.paramName === param.name);

        let input;
        if (param.type === 'boolean') {
            input = document.createElement('select');
            input.innerHTML = '<option value="true">true</option><option value="false">false</option>';
            input.value = String(currentVal);
        } else {
            input = document.createElement('input');
            input.type = param.type === 'number' ? 'number' : 'text';
            input.value = currentVal;
        }
        input.style.cssText = 'width:100%;padding:3px 5px;background:#0d1b2a;color:#e0e0e0;border:1px solid #1a4a7a;border-radius:3px;font-size:12px;margin-top:2px;';

        if (existingBinding) {
            input.disabled = true;
            input.style.opacity = '0.4';
        }

        input.addEventListener('change', () => {
            pushUndo();
            if (!state.behaviorParams) state.behaviorParams = {};
            let val = input.value;
            if (param.type === 'number') val = Number(val);
            else if (param.type === 'boolean') val = val === 'true';
            state.behaviorParams[param.name] = val;
        });

        const label = document.createElement('label');
        label.textContent = param.name;
        label.style.cssText = 'display:block;font-size:11px;color:#999;margin-bottom:6px;';
        label.appendChild(input);

        const hint = document.createElement('div');
        hint.className = 'param-hint';
        hint.textContent = param.description;
        label.appendChild(hint);

        // Param binding dropdown (if there are input ports)
        if (inputPorts.length > 0) {
            const bindSelect = document.createElement('select');
            bindSelect.style.cssText = 'width:100%;padding:2px 4px;background:#0d1b2a;color:#e0e0e0;border:1px solid #1a4a7a;border-radius:3px;font-size:10px;margin-top:2px;';
            bindSelect.innerHTML = '<option value="">Use hardcoded value</option>';
            for (const ip of inputPorts) {
                const opt = document.createElement('option');
                opt.value = ip.id;
                opt.textContent = `Port: ${ip.name} (${ip.valueType})`;
                if (existingBinding && existingBinding.portId === ip.id) opt.selected = true;
                bindSelect.appendChild(opt);
            }

            bindSelect.addEventListener('change', () => {
                pushUndo();
                if (!state.paramBindings) state.paramBindings = [];
                state.paramBindings = state.paramBindings.filter(b => b.paramName !== param.name);
                if (bindSelect.value) {
                    state.paramBindings.push({ paramName: param.name, portId: bindSelect.value });
                    input.disabled = true;
                    input.style.opacity = '0.4';
                } else {
                    input.disabled = false;
                    input.style.opacity = '1';
                }
            });

            label.appendChild(bindSelect);
        }

        row.appendChild(label);
        container.appendChild(row);
    }
}

function updateInterruptHandlers(state) {
    const container = document.getElementById('interrupt-handlers');
    container.innerHTML = '';

    if (!state.interruptHandlers) state.interruptHandlers = [];

    for (const intType of INTERRUPT_TYPES) {
        let handler = state.interruptHandlers.find(h => h.interruptType === intType);
        if (!handler) {
            handler = { interruptType: intType, action: 'ignore' };
            state.interruptHandlers.push(handler);
        }

        const row = document.createElement('div');
        row.className = 'interrupt-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'int-name';
        nameSpan.textContent = intType.replace(/_/g, ' ');
        nameSpan.title = intType;

        const actionSelect = document.createElement('select');
        actionSelect.innerHTML = `
            <option value="ignore">ignore</option>
            <option value="pause">pause</option>
            <option value="transition">transition</option>
        `;
        actionSelect.value = handler.action;

        const targetSelect = document.createElement('select');
        targetSelect.innerHTML = '<option value="">-- target --</option>';
        for (const s of profile.states) {
            if (s.id === state.id) continue;
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name || s.id.slice(0, 8);
            if (s.id === handler.targetStateId) opt.selected = true;
            targetSelect.appendChild(opt);
        }
        targetSelect.style.display = handler.action === 'transition' ? '' : 'none';

        actionSelect.addEventListener('change', () => {
            pushUndo();
            handler.action = actionSelect.value;
            targetSelect.style.display = handler.action === 'transition' ? '' : 'none';
            if (handler.action !== 'transition') delete handler.targetStateId;
        });

        targetSelect.addEventListener('change', () => {
            pushUndo();
            handler.targetStateId = targetSelect.value || undefined;
        });

        row.appendChild(nameSpan);
        row.appendChild(actionSelect);
        row.appendChild(targetSelect);
        container.appendChild(row);
    }
}

function updatePortsList(state) {
    const container = document.getElementById('ports-list');
    container.innerHTML = '';

    const ports = state.ports || [];

    for (const port of ports) {
        const row = document.createElement('div');
        row.className = 'port-row';

        // Color indicator dot
        const dot = document.createElement('span');
        dot.className = 'port-dot';
        dot.style.backgroundColor = PORT_TYPE_COLORS[port.valueType] || '#666';
        row.appendChild(dot);

        // Side badge
        const sideSelect = document.createElement('select');
        sideSelect.className = 'port-side-select';
        sideSelect.innerHTML = '<option value="input">IN</option><option value="output">OUT</option>';
        sideSelect.value = port.side;
        sideSelect.addEventListener('change', () => {
            const hasConn = (profile.dataConnections || []).some(
                c => (c.fromStateId === state.id && c.fromPortId === port.id) ||
                     (c.toStateId === state.id && c.toPortId === port.id)
            );
            if (hasConn) {
                showToast('Remove connections first', 'error');
                sideSelect.value = port.side;
                return;
            }
            pushUndo();
            port.side = sideSelect.value;
            // Re-render param bindings since available input ports changed
            updateBehaviorParams(state);
        });
        row.appendChild(sideSelect);

        // Name input
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'port-name-input';
        nameInput.value = port.name;
        nameInput.addEventListener('change', () => {
            pushUndo();
            port.name = nameInput.value;
        });
        row.appendChild(nameInput);

        // Type dropdown
        const typeSelect = document.createElement('select');
        typeSelect.className = 'port-type-select';
        for (const t of PORT_VALUE_TYPES) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            if (t === port.valueType) opt.selected = true;
            typeSelect.appendChild(opt);
        }
        typeSelect.addEventListener('change', () => {
            const hasConn = (profile.dataConnections || []).some(
                c => (c.fromStateId === state.id && c.fromPortId === port.id) ||
                     (c.toStateId === state.id && c.toPortId === port.id)
            );
            if (hasConn) {
                showToast('Remove connections before changing type', 'error');
                typeSelect.value = port.valueType;
                return;
            }
            pushUndo();
            port.valueType = typeSelect.value;
            dot.style.backgroundColor = PORT_TYPE_COLORS[port.valueType] || '#666';
        });
        row.appendChild(typeSelect);

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'port-delete-btn';
        delBtn.textContent = '\u00d7';
        delBtn.addEventListener('click', () => {
            pushUndo();
            profile.dataConnections = (profile.dataConnections || []).filter(
                c => !(c.fromStateId === state.id && c.fromPortId === port.id) &&
                     !(c.toStateId === state.id && c.toPortId === port.id)
            );
            state.paramBindings = (state.paramBindings || []).filter(
                b => b.portId !== port.id
            );
            state.ports = (state.ports || []).filter(p => p.id !== port.id);
            updatePortsList(state);
            updateBehaviorParams(state);
        });
        row.appendChild(delBtn);

        container.appendChild(row);
    }

    // Add Port button
    const addBtn = document.createElement('button');
    addBtn.className = 'port-add-btn';
    addBtn.textContent = '+ Add Port';
    addBtn.addEventListener('click', () => {
        pushUndo();
        if (!state.ports) state.ports = [];
        state.ports.push({
            id: genId(),
            name: `port${state.ports.length + 1}`,
            valueType: 'number',
            side: 'output',
        });
        updatePortsList(state);
    });
    container.appendChild(addBtn);
}

function populateTransitionPanel(transId) {
    const trans = getTransition(transId);
    if (!trans) return;

    document.getElementById('transition-label').value = trans.label || '';
    document.getElementById('transition-priority').value = trans.priority;

    const condType = document.getElementById('transition-condition-type');
    condType.value = trans.condition?.type || 'behavior_complete';

    updateConditionParams(trans);
}

function updateConditionParams(trans) {
    const container = document.getElementById('condition-params');
    container.innerHTML = '';
    const cond = trans.condition || { type: 'behavior_complete' };

    switch (cond.type) {
        case 'timer':
            addConditionInput(container, 'Duration (ms)', 'number', cond.durationMs || 5000, (v) => {
                pushUndo();
                trans.condition = { type: 'timer', durationMs: Number(v) };
            });
            break;

        case 'inventory_percent_full':
            addConditionOperatorInput(container, cond.operator || '>=', cond.value || 90, (op, val) => {
                pushUndo();
                trans.condition = { type: 'inventory_percent_full', operator: op, value: Number(val) };
            }, ['>=', '<']);
            break;

        case 'health_percent':
            addConditionOperatorInput(container, cond.operator || '<', cond.value || 50, (op, val) => {
                pushUndo();
                trans.condition = { type: 'health_percent', operator: op, value: Number(val) };
            }, ['>=', '<', '<=']);
            break;

        case 'item_count':
            addConditionInput(container, 'Item Pattern', 'text', cond.itemPattern || '', (v) => {
                pushUndo();
                trans.condition = { ...trans.condition, type: 'item_count', itemPattern: v };
            });
            addConditionOperatorInput(container, cond.operator || '>=', cond.value || 1, (op, val) => {
                pushUndo();
                trans.condition = { ...trans.condition, type: 'item_count', operator: op, value: Number(val) };
            }, ['>=', '<', '==']);
            break;

        case 'skill_level':
            addConditionInput(container, 'Skill Name', 'text', cond.skillName || '', (v) => {
                pushUndo();
                trans.condition = { ...trans.condition, type: 'skill_level', skillName: v };
            });
            addConditionOperatorInput(container, cond.operator || '>=', cond.value || 1, (op, val) => {
                pushUndo();
                trans.condition = { ...trans.condition, type: 'skill_level', operator: op, value: Number(val) };
            }, ['>=', '<']);
            break;
    }
}

function addConditionInput(container, labelText, type, value, onChange) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    label.appendChild(input);
    container.appendChild(label);
}

function addConditionOperatorInput(container, operator, value, onChange, operators) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';

    const opSelect = document.createElement('select');
    for (const op of operators) {
        const opt = document.createElement('option');
        opt.value = op;
        opt.textContent = op;
        if (op === operator) opt.selected = true;
        opSelect.appendChild(opt);
    }
    opSelect.style.cssText = 'width:60px;padding:4px;background:#0d1b2a;color:#e0e0e0;border:1px solid #1a4a7a;border-radius:3px;font-size:12px;';

    const valInput = document.createElement('input');
    valInput.type = 'number';
    valInput.value = value;
    valInput.style.cssText = 'flex:1;padding:4px;background:#0d1b2a;color:#e0e0e0;border:1px solid #1a4a7a;border-radius:3px;font-size:12px;';

    opSelect.addEventListener('change', () => onChange(opSelect.value, valInput.value));
    valInput.addEventListener('change', () => onChange(opSelect.value, valInput.value));

    row.appendChild(opSelect);
    row.appendChild(valInput);
    container.appendChild(row);
}

// ============ Mouse Events ============

canvas.addEventListener('mousedown', (e) => {
    hideContextMenu();
    const world = screenToWorld(e.clientX, e.clientY);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
        panning = true;
        panStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
        canvas.style.cursor = 'grabbing';
        return;
    }

    if (e.button === 0) {
        // 1. Check data port hit first (for drawing data connections)
        const dataPortHit = hitTestDataPort(world.x, world.y);
        if (dataPortHit && dataPortHit.port.side === 'output') {
            drawingDataConnection = {
                fromStateId: dataPortHit.stateId,
                fromPortId: dataPortHit.portId,
                valueType: dataPortHit.port.valueType,
                worldX: world.x,
                worldY: world.y,
            };
            canvas.style.cursor = 'crosshair';
            return;
        }

        // 2. Check transition port hit (for drawing transitions)
        const portNodeId = hitTestPort(world.x, world.y);
        if (portNodeId) {
            drawingTransition = { fromNodeId: portNodeId, worldX: world.x, worldY: world.y };
            canvas.style.cursor = 'crosshair';
            return;
        }

        // 3. Check node hit
        const nodeId = hitTestNode(world.x, world.y);
        if (nodeId) {
            const state = getState(nodeId);
            selectNode(nodeId);
            dragging = {
                nodeId,
                offsetX: world.x - state.x,
                offsetY: world.y - state.y,
            };
            canvas.style.cursor = 'move';
            return;
        }

        // 4. Check data connection hit
        const connId = hitTestDataConnection(world.x, world.y);
        if (connId) {
            selectDataConnection(connId);
            return;
        }

        // 5. Check transition hit
        const transId = hitTestTransition(world.x, world.y);
        if (transId) {
            selectTransition(transId);
            return;
        }

        // 6. Clicked empty space
        clearSelection();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const world = screenToWorld(e.clientX, e.clientY);

    if (panning) {
        camera.x = e.clientX - panStart.x;
        camera.y = e.clientY - panStart.y;
        return;
    }

    if (dragging) {
        const state = getState(dragging.nodeId);
        if (state) {
            state.x = Math.round((world.x - dragging.offsetX) / GRID_SIZE) * GRID_SIZE;
            state.y = Math.round((world.y - dragging.offsetY) / GRID_SIZE) * GRID_SIZE;
            markDirty();
        }
        return;
    }

    if (drawingTransition) {
        drawingTransition.worldX = world.x;
        drawingTransition.worldY = world.y;
        return;
    }

    if (drawingDataConnection) {
        drawingDataConnection.worldX = world.x;
        drawingDataConnection.worldY = world.y;
        return;
    }

    // Hover cursor
    const dataPortHit = hitTestDataPort(world.x, world.y);
    if (dataPortHit) {
        canvas.style.cursor = 'crosshair';
    } else if (hitTestPort(world.x, world.y)) {
        canvas.style.cursor = 'crosshair';
    } else if (hitTestNode(world.x, world.y)) {
        canvas.style.cursor = 'pointer';
    } else if (hitTestDataConnection(world.x, world.y)) {
        canvas.style.cursor = 'pointer';
    } else if (hitTestTransition(world.x, world.y)) {
        canvas.style.cursor = 'pointer';
    } else {
        canvas.style.cursor = 'default';
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (panning) {
        panning = false;
        canvas.style.cursor = 'default';
        return;
    }

    if (dragging) {
        pushUndo();
        dragging = null;
        canvas.style.cursor = 'default';
        return;
    }

    if (drawingDataConnection) {
        const world = screenToWorld(e.clientX, e.clientY);
        const target = hitTestDataPort(world.x, world.y);

        if (target && target.port.side === 'input' &&
            target.stateId !== drawingDataConnection.fromStateId &&
            target.port.valueType === drawingDataConnection.valueType) {
            // Check if input already has a connection
            const existing = (profile.dataConnections || []).find(
                c => c.toStateId === target.stateId && c.toPortId === target.portId
            );
            if (existing) {
                showToast('Input port already connected', 'error');
            } else {
                pushUndo();
                if (!profile.dataConnections) profile.dataConnections = [];
                const conn = {
                    id: genId(),
                    fromStateId: drawingDataConnection.fromStateId,
                    fromPortId: drawingDataConnection.fromPortId,
                    toStateId: target.stateId,
                    toPortId: target.portId,
                };
                profile.dataConnections.push(conn);
                selectDataConnection(conn.id);
                showToast('Data connection created');
            }
        } else if (target && target.port.side === 'input' &&
                   target.port.valueType !== drawingDataConnection.valueType) {
            showToast(`Type mismatch: ${drawingDataConnection.valueType} \u2192 ${target.port.valueType}`, 'error');
        }

        drawingDataConnection = null;
        canvas.style.cursor = 'default';
        return;
    }

    if (drawingTransition) {
        const world = screenToWorld(e.clientX, e.clientY);
        const targetNodeId = hitTestNode(world.x, world.y);

        if (targetNodeId && targetNodeId !== drawingTransition.fromNodeId) {
            pushUndo();
            const trans = {
                id: genId(),
                fromStateId: drawingTransition.fromNodeId,
                toStateId: targetNodeId,
                condition: { type: 'behavior_complete' },
                priority: 10,
            };
            profile.transitions.push(trans);
            selectTransition(trans.id);
        }

        drawingTransition = null;
        canvas.style.cursor = 'default';
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(3, camera.zoom * zoomFactor));

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    camera.x = mx - (mx - camera.x) * (newZoom / camera.zoom);
    camera.y = my - (my - camera.y) * (newZoom / camera.zoom);
    camera.zoom = newZoom;
}, { passive: false });

canvas.addEventListener('dblclick', (e) => {
    const world = screenToWorld(e.clientX, e.clientY);
    if (hitTestNode(world.x, world.y) || hitTestPort(world.x, world.y) || hitTestDataPort(world.x, world.y)) return;

    pushUndo();
    const newState = {
        id: genId(),
        name: 'New State',
        behaviorName: 'idle',
        behaviorParams: {},
        interruptHandlers: [],
        ports: [],
        x: Math.round(world.x / GRID_SIZE) * GRID_SIZE,
        y: Math.round(world.y / GRID_SIZE) * GRID_SIZE,
        color: DEFAULT_COLORS[profile.states.length % DEFAULT_COLORS.length],
    };
    profile.states.push(newState);
    if (!profile.initialStateId) {
        profile.initialStateId = newState.id;
    }
    selectNode(newState.id);
    showToast('State added');
});

// ============ Context Menu ============

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const world = screenToWorld(e.clientX, e.clientY);
    const nodeId = hitTestNode(world.x, world.y);
    const connId = !nodeId ? hitTestDataConnection(world.x, world.y) : null;
    const transId = (!nodeId && !connId) ? hitTestTransition(world.x, world.y) : null;

    if (nodeId) {
        contextMenuTarget = { type: 'node', id: nodeId };
        selectNode(nodeId);
    } else if (connId) {
        contextMenuTarget = { type: 'connection', id: connId };
        selectDataConnection(connId);
    } else if (transId) {
        contextMenuTarget = { type: 'transition', id: transId };
        selectTransition(transId);
    } else {
        contextMenuTarget = { type: 'canvas', x: world.x, y: world.y };
    }

    const setInitialItem = contextMenu.querySelector('[data-action="set-initial"]');
    const deleteItem = contextMenu.querySelector('[data-action="delete"]');
    setInitialItem.style.display = contextMenuTarget.type === 'node' ? '' : 'none';
    deleteItem.classList.toggle('disabled', contextMenuTarget.type === 'canvas');

    contextMenu.style.display = 'block';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
});

contextMenu.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (!action || !contextMenuTarget) return;
    const target = contextMenuTarget;
    hideContextMenu();

    switch (action) {
        case 'add-state': {
            pushUndo();
            const x = target.x ?? 100;
            const y = target.y ?? 100;
            const newState = {
                id: genId(),
                name: 'New State',
                behaviorName: 'idle',
                behaviorParams: {},
                interruptHandlers: [],
                ports: [],
                x: Math.round(x / GRID_SIZE) * GRID_SIZE,
                y: Math.round(y / GRID_SIZE) * GRID_SIZE,
                color: DEFAULT_COLORS[profile.states.length % DEFAULT_COLORS.length],
            };
            profile.states.push(newState);
            if (!profile.initialStateId) {
                profile.initialStateId = newState.id;
            }
            selectNode(newState.id);
            showToast('State added');
            break;
        }
        case 'set-initial': {
            if (target.type === 'node') {
                pushUndo();
                profile.initialStateId = target.id;
                showToast('Initial state updated');
            }
            break;
        }
        case 'delete': {
            if (target.type === 'node') {
                deleteNode(target.id);
                showToast('State deleted');
            } else if (target.type === 'transition') {
                deleteTransition(target.id);
                showToast('Transition deleted');
            } else if (target.type === 'connection') {
                deleteDataConnection(target.id);
                showToast('Data connection deleted');
            }
            break;
        }
    }
});

function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextMenuTarget = null;
}

// ============ Toast Notifications ============

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    toast.offsetHeight;
    toast.classList.add('toast-visible');
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
});

function deleteNode(nodeId) {
    pushUndo();
    profile.states = profile.states.filter(s => s.id !== nodeId);
    profile.transitions = profile.transitions.filter(t => t.fromStateId !== nodeId && t.toStateId !== nodeId);
    profile.dataConnections = (profile.dataConnections || []).filter(
        c => c.fromStateId !== nodeId && c.toStateId !== nodeId
    );
    if (profile.initialStateId === nodeId) {
        profile.initialStateId = profile.states[0]?.id || '';
    }
    for (const s of profile.states) {
        for (const h of (s.interruptHandlers || [])) {
            if (h.targetStateId === nodeId) {
                h.action = 'ignore';
                delete h.targetStateId;
            }
        }
    }
    clearSelection();
}

function deleteTransition(transId) {
    pushUndo();
    profile.transitions = profile.transitions.filter(t => t.id !== transId);
    clearSelection();
}

function deleteDataConnection(connId) {
    pushUndo();
    profile.dataConnections = (profile.dataConnections || []).filter(c => c.id !== connId);
    clearSelection();
}

// ============ Keyboard Shortcuts ============

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) deleteNode(selectedNodeId);
        else if (selectedTransitionId) deleteTransition(selectedTransitionId);
        else if (selectedConnectionId) deleteDataConnection(selectedConnectionId);
        e.preventDefault();
    }

    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'y') { e.preventDefault(); redo(); }
        if (e.key === 's') { e.preventDefault(); saveProfile(); }
        if (e.key === 'n') { e.preventDefault(); newProfile(); }
    }
});

// ============ Panel Event Handlers ============

document.getElementById('state-name').addEventListener('input', (e) => {
    if (!selectedNodeId) return;
    const state = getState(selectedNodeId);
    if (state) {
        pushUndo();
        state.name = e.target.value;
    }
});

document.getElementById('state-behavior').addEventListener('change', (e) => {
    if (!selectedNodeId) return;
    const state = getState(selectedNodeId);
    if (state) {
        pushUndo();
        state.behaviorName = e.target.value;
        state.behaviorParams = {};
        state.paramBindings = [];
        updateBehaviorDescription(state.behaviorName);
        updateBehaviorParams(state);
    }
});

document.getElementById('state-color').addEventListener('input', (e) => {
    if (!selectedNodeId) return;
    const state = getState(selectedNodeId);
    if (state) {
        state.color = e.target.value;
        markDirty();
    }
});

document.getElementById('transition-label').addEventListener('input', (e) => {
    if (!selectedTransitionId) return;
    const trans = getTransition(selectedTransitionId);
    if (trans) { pushUndo(); trans.label = e.target.value; }
});

document.getElementById('transition-priority').addEventListener('change', (e) => {
    if (!selectedTransitionId) return;
    const trans = getTransition(selectedTransitionId);
    if (trans) { pushUndo(); trans.priority = Number(e.target.value); }
});

document.getElementById('transition-condition-type').addEventListener('change', (e) => {
    if (!selectedTransitionId) return;
    const trans = getTransition(selectedTransitionId);
    if (trans) {
        pushUndo();
        const type = e.target.value;
        switch (type) {
            case 'behavior_complete': trans.condition = { type: 'behavior_complete' }; break;
            case 'timer': trans.condition = { type: 'timer', durationMs: 5000 }; break;
            case 'inventory_percent_full': trans.condition = { type: 'inventory_percent_full', operator: '>=', value: 90 }; break;
            case 'health_percent': trans.condition = { type: 'health_percent', operator: '<', value: 50 }; break;
            case 'item_count': trans.condition = { type: 'item_count', itemPattern: '', operator: '>=', value: 1 }; break;
            case 'skill_level': trans.condition = { type: 'skill_level', skillName: '', operator: '>=', value: 1 }; break;
            case 'always': trans.condition = { type: 'always' }; break;
        }
        updateConditionParams(trans);
    }
});

// ============ Toolbar Buttons ============

document.getElementById('btn-new').addEventListener('click', newProfile);
document.getElementById('btn-save').addEventListener('click', saveProfile);
document.getElementById('btn-delete').addEventListener('click', deleteCurrentProfile);
document.getElementById('btn-compile').addEventListener('click', compileProfile);
document.getElementById('btn-export').addEventListener('click', exportProfile);
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', importProfile);
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);
document.getElementById('btn-activate').addEventListener('click', activateOnBot);
document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('compile-modal').style.display = 'none';
});

document.getElementById('profile-name').addEventListener('input', (e) => {
    profile.name = e.target.value;
    markDirty();
});

document.getElementById('profile-select').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) return;
    await loadProfile(id);
    e.target.value = '';
});

// ============ API Functions ============

async function newProfile() {
    try {
        const res = await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Untitled Profile' }),
        });
        const data = await res.json();
        profile = data;
        if (!profile.dataConnections) profile.dataConnections = [];
        camera = { x: 0, y: 0, zoom: 1 };
        undoStack = [];
        redoStack = [];
        clearSelection();
        document.getElementById('profile-name').value = profile.name;
        refreshProfileList();
    } catch (e) {
        console.error('Failed to create profile:', e);
        showToast('Failed to create profile', 'error');
    }
}

async function saveProfile() {
    if (!profile.id) {
        await newProfile();
        return;
    }
    profile.updatedAt = new Date().toISOString();
    profile.editorMeta = { canvasOffsetX: camera.x, canvasOffsetY: camera.y, zoom: camera.zoom };
    try {
        await fetch(`/api/profiles/${profile.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profile),
        });
        isDirty = false;
        refreshProfileList();
        showToast('Profile saved');
    } catch (e) {
        console.error('Failed to save:', e);
        showToast('Save failed', 'error');
    }
}

async function loadProfile(id) {
    try {
        const res = await fetch(`/api/profiles/${id}`);
        if (!res.ok) return;
        profile = await res.json();
        if (!profile.dataConnections) profile.dataConnections = [];
        camera.x = profile.editorMeta?.canvasOffsetX || 0;
        camera.y = profile.editorMeta?.canvasOffsetY || 0;
        camera.zoom = profile.editorMeta?.zoom || 1;
        undoStack = [];
        redoStack = [];
        clearSelection();
        document.getElementById('profile-name').value = profile.name;
    } catch (e) {
        console.error('Failed to load profile:', e);
        showToast('Failed to load profile', 'error');
    }
}

async function deleteCurrentProfile() {
    if (!profile.id) return;
    if (!confirm(`Delete profile "${profile.name}"?`)) return;
    try {
        await fetch(`/api/profiles/${profile.id}`, { method: 'DELETE' });
        profile = createEmptyProfile();
        clearSelection();
        document.getElementById('profile-name').value = '';
        refreshProfileList();
        showToast('Profile deleted');
    } catch (e) {
        console.error('Failed to delete:', e);
        showToast('Failed to delete profile', 'error');
    }
}

async function compileProfile() {
    if (!profile.id) { showToast('Save the profile first', 'error'); return; }
    await saveProfile();
    try {
        const res = await fetch(`/api/profiles/${profile.id}/compile`, { method: 'POST' });
        const data = await res.json();
        if (data.error) { showToast('Compile error: ' + data.error, 'error'); return; }
        document.getElementById('compile-output').textContent = data.code;
        document.getElementById('compile-modal').style.display = 'flex';
    } catch (e) {
        console.error('Compile failed:', e);
        showToast('Compile failed', 'error');
    }
}

function exportProfile() {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.name || 'profile'}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

async function importProfile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
        const text = await file.text();
        const imported = JSON.parse(text);
        const res = await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(imported),
        });
        const data = await res.json();
        profile = data;
        if (!profile.dataConnections) profile.dataConnections = [];
        camera = { x: profile.editorMeta?.canvasOffsetX || 0, y: profile.editorMeta?.canvasOffsetY || 0, zoom: profile.editorMeta?.zoom || 1 };
        undoStack = [];
        redoStack = [];
        clearSelection();
        document.getElementById('profile-name').value = profile.name;
        refreshProfileList();
    } catch (err) {
        console.error('Failed to import:', err);
        showToast('Failed to import: ' + err.message, 'error');
    }
    e.target.value = '';
}

async function activateOnBot() {
    const botSelect = document.getElementById('bot-select');
    const username = botSelect.value;
    if (!username) { showToast('Select a bot first', 'error'); return; }
    if (!profile.id) { showToast('Save the profile first', 'error'); return; }
    await saveProfile();
    try {
        const res = await fetch(`/api/bots/${encodeURIComponent(username)}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: profile.id }),
        });
        const data = await res.json();
        if (data.error) showToast('Activation failed: ' + data.error, 'error');
        else showToast(`Profile activated on ${username}`);
    } catch (e) {
        console.error('Failed to activate:', e);
        showToast('Failed to activate: ' + e.message, 'error');
    }
}

async function refreshProfileList() {
    try {
        const res = await fetch('/api/profiles');
        const profiles = await res.json();
        const select = document.getElementById('profile-select');
        select.innerHTML = '<option value="">-- Load Profile --</option>';
        for (const p of profiles) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        }
    } catch {}
}

async function refreshBotList() {
    try {
        const res = await fetch('/api/bots');
        const data = await res.json();
        const select = document.getElementById('bot-select');
        select.innerHTML = '<option value="">-- Select Bot --</option>';
        if (data.bots) {
            for (const [username, info] of Object.entries(data.bots)) {
                const opt = document.createElement('option');
                opt.value = username;
                opt.textContent = `${username} (${info.status})`;
                select.appendChild(opt);
            }
        }
    } catch {}
}

async function fetchBehaviors() {
    try {
        const res = await fetch('/api/behaviors');
        behaviors = await res.json();
    } catch {}
}

async function fetchInterrupts() {
    try {
        const res = await fetch('/api/interrupts');
        interruptPriorities = await res.json();
    } catch {}
}

// ============ Initialization ============

function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    fetchBehaviors();
    fetchInterrupts();
    refreshProfileList();
    refreshBotList();

    setInterval(refreshBotList, 10000);

    requestAnimationFrame(render);
}

init();

})();
