import React, { useState, useRef, useEffect } from 'react';
import { 
    FaSearchPlus, 
    FaSearchMinus, 
    FaExpand, 
    FaClock, 
    FaUser, 
    FaCheckCircle, 
    FaTimesCircle, 
    FaSync, 
    FaBan, 
    FaArrowRight 
} from 'react-icons/fa';

/**
 * TimelineViewer
 * Renders an interactive SVG-based flowchart showing the document's path.
 * Supports panning, zooming, custom HTML rendering in nodes, and loop analysis.
 * 
 * @param {Array} nodes - Evaluated nodes (activities)
 * @param {Array} edges - Evaluated edges (connections)
 */
export const TimelineViewer = ({ nodes = [], edges = [], height = 'h-[600px]' }) => {
    const [transform, setTransform] = useState({ scale: 0.8, x: 50, y: 50 });
    const [selectedNode, setSelectedNode] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const svgRef = useRef(null);

    // Auto-fit the view when nodes are loaded or container resizes
    useEffect(() => {
        if (!nodes || nodes.length === 0) return;
        const svgEl = svgRef.current;
        if (!svgEl) return;

        const resizeObserver = new ResizeObserver(() => {
            handleFitView();
        });
        resizeObserver.observe(svgEl);

        return () => {
            resizeObserver.disconnect();
        };
    }, [nodes]);

    // Handle Mouse Panning (Drag Canvas)
    const handleMouseDown = (e) => {
        // Prevent drag on text selection or card clicks
        if (e.target.closest('.node-card') || e.target.closest('.toolbar-btn')) return;
        setIsDragging(true);
        dragStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
    };

    const handleMouseMove = (e) => {
        if (!isDragging) return;
        setTransform(prev => ({
            ...prev,
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y
        }));
    };

    const handleMouseUp = () => setIsDragging(false);

    // Handle Natural Wheel Zoom (Zoom in/out at mouse pointer)
    useEffect(() => {
        const svgEl = svgRef.current;
        if (!svgEl) return;

        const handleWheelEvent = (e) => {
            e.preventDefault();
            const zoomSpeed = 1.08;
            
            setTransform(prev => {
                const nextScale = e.deltaY < 0 ? prev.scale * zoomSpeed : prev.scale / zoomSpeed;
                const boundedScale = Math.min(Math.max(nextScale, 0.15), 3.0);

                const rect = svgEl.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const dx = mouseX - prev.x;
                const dy = mouseY - prev.y;

                return {
                    scale: boundedScale,
                    x: mouseX - dx * (boundedScale / prev.scale),
                    y: mouseY - dy * (boundedScale / prev.scale)
                };
            });
        };

        svgEl.addEventListener('wheel', handleWheelEvent, { passive: false });
        return () => {
            svgEl.removeEventListener('wheel', handleWheelEvent);
        };
    }, []);

    // Zoom Buttons
    const handleZoomIn = () => {
        setTransform(prev => ({ ...prev, scale: Math.min(prev.scale * 1.2, 3.0) }));
    };

    const handleZoomOut = () => {
        setTransform(prev => ({ ...prev, scale: Math.max(prev.scale / 1.2, 0.15) }));
    };

    const handleFitView = () => {
        if (!nodes || nodes.length === 0 || !svgRef.current) return;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            if (n.x < minX) minX = n.x;
            if (n.x + n.width > maxX) maxX = n.x + n.width;
            if (n.y < minY) minY = n.y;
            if (n.y + n.height > maxY) maxY = n.y + n.height;
        });

        const graphW = maxX - minX;
        const graphH = maxY - minY;

        const containerW = svgRef.current.clientWidth || 800;
        const containerH = svgRef.current.clientHeight || 500;

        // Calculate best fit scale
        const scaleX = (containerW - 100) / graphW;
        const scaleY = (containerH - 100) / graphH;
        const bestScale = Math.min(scaleX, scaleY, 1.0);
        const boundedScale = Math.max(bestScale, 0.25);

        // Center offsets
        const offsetX = (containerW - graphW * boundedScale) / 2 - minX * boundedScale;
        const offsetY = (containerH - graphH * boundedScale) / 2 - minY * boundedScale;

        setTransform({
            scale: boundedScale,
            x: offsetX,
            y: offsetY
        });
    };

    // Helper to draw connection lines between nodes
    const renderEdge = (edge) => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);

        if (!sourceNode || !targetNode) return null;

        // Check if source is directly above target (e.g. aligned horizontally and source is higher)
        const isVertical = Math.abs(sourceNode.x - targetNode.x) < 20 && targetNode.y > sourceNode.y;

        // Calculate anchors: Output from right side, Input from left side (unless vertical)
        const x1 = isVertical ? (sourceNode.x + sourceNode.width / 2) : (sourceNode.x + sourceNode.width);
        const y1 = isVertical ? (sourceNode.y + sourceNode.height) : (sourceNode.y + sourceNode.height / 2);
        const x2 = isVertical ? (targetNode.x + targetNode.width / 2) : targetNode.x;
        const y2 = isVertical ? targetNode.y : (targetNode.y + targetNode.height / 2);

        let pathData = '';

        if (isVertical) {
            // Draw clean vertical line downwards
            pathData = `M ${x1} ${y1} L ${x2} ${y2}`;
        } else if (x2 < x1) {
            // If drawing a loop backward, route curve above/below to avoid collisions
            const verticalDist = Math.abs(y2 - y1);
            const loopCurve = Math.max(verticalDist, 130);
            pathData = `M ${x1} ${y1} C ${x1 + 100} ${y1 - loopCurve}, ${x2 - 100} ${y2 - loopCurve}, ${x2} ${y2}`;
        } else {
            // Draw clean horizontal S-curve
            const dx = Math.abs(x2 - x1) * 0.45;
            pathData = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        }

        // Determine line stroke styling
        let strokeColor = '#cbd5e1'; // default: pending
        let strokeWidth = '2';
        let strokeDash = '0';
        let isAnimated = false;

        if (edge.status === 'taken') {
            strokeColor = '#10b981'; // Green for taken paths
            strokeWidth = '4';
            isAnimated = true;
        } else if (edge.status === 'active') {
            strokeColor = '#3b82f6'; // Blue for active task
            strokeWidth = '4';
            strokeDash = '6';
            isAnimated = true;
        } else if (edge.status === 'skipped') {
            strokeColor = '#94a3b8'; // Light gray skipped path
            strokeWidth = '1.5';
            strokeDash = '4,4';
            isAnimated = false;
        }

        return (
            <g key={edge.id}>
                {/* Background Shadow line for premium feel */}
                <path
                    d={pathData}
                    stroke="rgba(0,0,0,0.05)"
                    strokeWidth={parseInt(strokeWidth) + 3}
                    fill="none"
                />
                
                {/* Main colored connection path */}
                <path
                    d={pathData}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDash !== '0' ? strokeDash : undefined}
                    fill="none"
                />

                {/* Flow dash overlay for completed paths */}
                {isAnimated && (
                    <path
                        d={pathData}
                        stroke={edge.status === 'taken' ? '#a7f3d0' : '#93c5fd'}
                        strokeWidth={strokeWidth}
                        strokeDasharray="8,10"
                        className="animate-flow-dashes"
                        fill="none"
                    />
                )}

                {/* Connection Label (e.g. Approved / Rejected / Condition value) */}
                {edge.label && (
                    <g transform={`translate(${(x1 + x2) / 2}, ${isVertical ? ((y1 + y2) / 2) : ((y1 + y2) / 2 - 8)})`}>
                        <rect
                            x={-edge.label.length * 4 - 8}
                            y={-10}
                            width={edge.label.length * 8 + 16}
                            height={18}
                            fill="#ffffff"
                            rx="4"
                            stroke={strokeColor}
                            strokeWidth="1"
                            filter="drop-shadow(0px 1px 2px rgba(0,0,0,0.1))"
                        />
                        <text
                            textAnchor="middle"
                            alignmentBaseline="middle"
                            fill={edge.status === 'taken' ? '#065f46' : '#475569'}
                            fontSize="9"
                            fontWeight="bold"
                        >
                            {edge.label}
                        </text>
                    </g>
                )}
            </g>
        );
    };

    // Helper to determine node visual appearance
    const getNodeStyle = (status) => {
        switch (status) {
            case 'completed':
                return {
                    bg: 'bg-emerald-50 border-emerald-400',
                    text: 'text-emerald-950',
                    ring: 'ring-emerald-200 shadow-emerald-100',
                    badge: 'bg-emerald-500 text-white',
                    desc: 'Decisão Tomada'
                };
            case 'active':
                return {
                    bg: 'bg-blue-50 border-blue-200 shadow-lg shadow-blue-100',
                    text: 'text-blue-950',
                    ring: 'ring-blue-300 shadow-blue-200',
                    badge: 'bg-blue-600 text-white animate-bounce-slow',
                    desc: 'Etapa Atual'
                };
            case 'skipped':
                return {
                    bg: 'bg-slate-50 border-slate-200 opacity-60 grayscale',
                    text: 'text-slate-500',
                    ring: 'ring-transparent',
                    badge: 'bg-slate-300 text-slate-600',
                    desc: 'Não Aplicável'
                };
            default: // pending
                return {
                    bg: 'bg-white border-slate-300 hover:border-indigo-400 hover:shadow-md transition-all duration-300',
                    text: 'text-slate-700',
                    ring: 'ring-transparent',
                    badge: 'bg-slate-100 text-slate-500',
                    desc: 'Próxima Etapa'
                };
        }
    };

    const formatDate = (dateObj) => {
        if (!dateObj) return '';
        return dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
               dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={`relative w-full ${height} border border-slate-200 rounded-xl bg-white shadow-inner overflow-hidden select-none`}>
            {/* SVG Canvas Controls Toolbar */}
            <div className="absolute top-4 left-4 z-10 flex items-center space-x-1 bg-white/90 backdrop-blur border border-slate-200 p-1.5 rounded-lg shadow-md">
                <button 
                    onClick={handleZoomIn} 
                    className="btn btn-sm btn-ghost btn-square toolbar-btn text-slate-600 hover:bg-slate-100" 
                    title="Aumentar Zoom"
                >
                    <FaSearchPlus />
                </button>
                <button 
                    onClick={handleZoomOut} 
                    className="btn btn-sm btn-ghost btn-square toolbar-btn text-slate-600 hover:bg-slate-100" 
                    title="Diminuir Zoom"
                >
                    <FaSearchMinus />
                </button>
                <button 
                    onClick={handleFitView} 
                    className="btn btn-sm btn-ghost btn-square toolbar-btn text-slate-600 hover:bg-slate-100" 
                    title="Ajustar à Tela"
                >
                    <FaExpand />
                </button>
                <div className="w-[1px] h-6 bg-slate-200 mx-1" />
                <span className="text-[10px] font-mono font-bold text-slate-500 px-1">
                    {Math.round(transform.scale * 100)}%
                </span>
            </div>

            {/* SLA Alert / Info Bar */}
            <div className="absolute top-4 right-4 z-10 flex flex-col items-stretch gap-1.5 bg-white/95 backdrop-blur border border-slate-200 p-2 rounded-xl shadow-md text-[10px] font-bold min-w-[125px]">
                {/* Concluído Chip */}
                <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-lg">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                    <span>Concluído</span>
                </div>

                {/* Ativo Chip */}
                <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-800 border border-blue-100 rounded-lg">
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                    </span>
                    <span>Etapa Atual</span>
                </div>

                {/* Ignorado Chip */}
                <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-800 shrink-0"></span>
                    <span>Não Aplicável</span>
                </div>

                {/* Pendente Chip */}
                <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-200 border border-slate-300 shrink-0"></span>
                    <span>Próxima Etapa</span>
                </div>
            </div>

            <svg
                ref={svgRef}
                className={`w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <defs>
                    <style>
                        {`
                        @keyframes flowPath {
                            from { stroke-dashoffset: 20; }
                            to { stroke-dashoffset: 0; }
                        }
                        .animate-flow-dashes {
                            animation: flowPath 1.2s linear infinite;
                        }
                        .animate-pulse-glow {
                            box-shadow: 0 0 12px rgba(59, 130, 246, 0.4);
                        }
                        `}
                    </style>
                </defs>

                {/* Transform group representing Pan and Zoom */}
                <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
                    {/* 1. Draw connections behind cards */}
                    {edges.map(edge => renderEdge(edge))}

                    {/* 2. Draw activities utilizing foreignObject */}
                    {nodes.map(node => {
                        const style = getNodeStyle(node.status);
                        const lastExec = node.executions && node.executions.length > 0 
                            ? node.executions[node.executions.length - 1] 
                            : null;
                        const isSlaWarning = node.totalDurationMs > 86400000; // SLA alert if > 24 hours

                        return (
                            <foreignObject
                                key={node.id}
                                x={node.x}
                                y={node.y}
                                width={node.width}
                                height={node.height}
                            >
                                <div
                                    onClick={() => setSelectedNode(node)}
                                    className={`
                                        node-card h-full w-full border border-solid rounded-lg p-2.5 flex flex-col justify-between
                                        cursor-pointer transition-all duration-200 select-none shadow-sm
                                        ${style.bg}
                                    `}
                                >
                                    {/* Header Section */}
                                    <div className="flex justify-between items-start gap-1">
                                        <div className="flex-1 min-w-0">
                                            <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider truncate">
                                                {node.type}
                                            </span>
                                            <h4 className={`text-xs font-bold leading-tight truncate ${style.text}`} title={node.name}>
                                                {node.name}
                                            </h4>
                                        </div>
                                        {/* Status Badge */}
                                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${style.badge}`}>
                                            {node.status === 'completed' && '✓'}
                                            {node.status === 'active' && '●'}
                                            {node.status === 'skipped' && 'x'}
                                            {node.status === 'pending' && '...'}
                                        </span>
                                    </div>

                                    {/* Execution Details inside node card */}
                                    <div className="text-[10px] space-y-0.5">
                                        {node.status === 'completed' && lastExec && (
                                            <>
                                                <div className="flex items-center gap-1 text-slate-600">
                                                    <FaUser className="text-[8px] shrink-0" />
                                                    <span className="truncate max-w-[120px]">{lastExec.user.split('@')[0]}</span>
                                                </div>
                                                <div className="flex items-center justify-between mt-1 text-[9px] text-slate-500 border-t border-emerald-100 pt-1">
                                                    <span className="font-mono">{node.totalDurationText || '0s'}</span>
                                                    {isSlaWarning && (
                                                        <span className="badge badge-warning badge-xs text-[7px] font-bold scale-90">SLA</span>
                                                    )}
                                                    <span>{lastExec.completedAt ? formatDate(lastExec.completedAt).split(' ')[0] : ''}</span>
                                                </div>
                                            </>
                                        )}

                                        {node.status === 'active' && (
                                            <>
                                                <div className="flex items-center gap-1 text-blue-700 font-medium">
                                                    <FaClock className="text-[8px] shrink-0" />
                                                    <span>Etapa Atual</span>
                                                </div>
                                                <div className="text-[9px] font-mono text-blue-600 truncate mt-0.5">
                                                    Aguardando alçada...
                                                </div>
                                            </>
                                        )}

                                        {node.status === 'skipped' && (
                                            <span className="italic text-slate-400 block mt-1">Não Aplicável</span>
                                        )}

                                        {node.status === 'pending' && (
                                            <span className="text-slate-400 block mt-1">Próxima Etapa</span>
                                        )}
                                    </div>
                                </div>
                            </foreignObject>
                        );
                    })}
                </g>
            </svg>

            {/* Sidebar Inspector Panel (Node Details) */}
            {selectedNode && (
                <div className="absolute right-0 top-0 h-full w-80 bg-white border-l border-slate-200 shadow-2xl p-5 flex flex-col z-20 animate-fade-in-left">
                    {/* Header */}
                    <div className="flex justify-between items-start pb-4 border-b border-slate-100">
                        <div>
                            <span className="text-xs uppercase font-bold text-slate-400">{selectedNode.type}</span>
                            <h3 className="text-base font-bold text-slate-800 leading-snug">{selectedNode.name}</h3>
                        </div>
                        <button
                            onClick={() => setSelectedNode(null)}
                            className="btn btn-sm btn-circle btn-ghost"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Details Content */}
                    <div className="flex-1 overflow-y-auto py-4 space-y-4">
                        {/* Status Panel */}
                        <div className="bg-slate-50 p-3 rounded-lg flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-500">Status Atual</span>
                            <span className={`badge badge-md uppercase font-bold text-xs
                                ${selectedNode.status === 'completed' ? 'badge-success text-white' :
                                  selectedNode.status === 'active' ? 'badge-primary text-white' :
                                  selectedNode.status === 'skipped' ? 'badge-ghost text-slate-500' :
                                  'badge-outline border-slate-300 text-slate-500'}
                            `}>
                                {selectedNode.status === 'completed' && 'Concluído'}
                                {selectedNode.status === 'active' && 'Etapa Atual'}
                                {selectedNode.status === 'skipped' && 'Não Aplicável'}
                                {selectedNode.status === 'pending' && 'Próxima Etapa'}
                            </span>
                        </div>

                        {/* Description */}
                        {selectedNode.description && (
                            <div>
                                <span className="block text-xs font-bold text-slate-400 mb-1">Descrição</span>
                                <p className="text-xs text-slate-600 bg-slate-50/50 p-2 border border-slate-100 rounded leading-relaxed">
                                    {selectedNode.description}
                                </p>
                            </div>
                        )}

                        {/* Executions Logs (Handles Loops) */}
                        <div>
                            <span className="block text-xs font-bold text-slate-400 mb-2">
                                Histórico de Execuções ({selectedNode.executions.length})
                            </span>
                            
                            {selectedNode.executions.length === 0 ? (
                                <div className="text-xs italic text-slate-400 p-2 text-center">
                                    Nenhuma execução registrada nesta atividade.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {selectedNode.executions.map((exec, idx) => (
                                        <div key={idx} className="border border-slate-100 rounded-lg p-3 space-y-1.5 bg-white shadow-sm hover:border-slate-200 transition-colors">
                                            <div className="flex justify-between items-center text-[10px] text-slate-400">
                                                <span className="font-semibold text-indigo-600">Loop #{idx + 1}</span>
                                                <span className="font-mono">{exec.durationText || 'Instantâneo'}</span>
                                            </div>
                                            
                                            {/* Decision Taken */}
                                            {exec.decision && (
                                                <div className="flex items-center gap-1.5 text-xs">
                                                    <span className="font-semibold text-slate-700">Decisão:</span>
                                                    <span className="inline-flex items-center gap-1 font-bold text-emerald-600">
                                                        <FaCheckCircle className="text-[10px]" /> {exec.decision}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Processor User */}
                                            <div className="text-xs text-slate-600 flex items-center gap-1">
                                                <span className="font-semibold text-slate-700 shrink-0">Usuário:</span>
                                                <span className="truncate font-medium">{exec.user}</span>
                                            </div>

                                            {/* Timestamps */}
                                            <div className="text-[10px] text-slate-500 space-y-0.5 border-t border-slate-50 pt-1.5 mt-1 font-mono">
                                                {exec.startedAt && (
                                                    <div>Iniciado: {formatDate(exec.startedAt)}</div>
                                                )}
                                                {exec.completedAt && (
                                                    <div>Concluído: {formatDate(exec.completedAt)}</div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
