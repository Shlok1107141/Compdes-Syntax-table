import React, { useState, useMemo } from 'react';
import { Network, ZoomIn, ZoomOut, RotateCcw, Info, CheckCircle2 } from 'lucide-react';
import type { SymbolEntry } from '../types';

interface RadixTrieVisualizerProps {
  symbols: SymbolEntry[];
}

interface TrieNode {
  id: number;
  edgeLabel: string;
  isTerminal: boolean;
  symbolName?: string;
  symbolType?: string;
  arenaIndex: number;
  children: TrieNode[];
}

export const RadixTrieVisualizer: React.FC<RadixTrieVisualizerProps> = ({ symbols }) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedNode, setSelectedNode] = useState<TrieNode | null>(null);

  const { root, totalNodes, totalDeduplicatedBytes, rawStringBytes } = useMemo(() => {
    let nodeIdCounter = 0;
    let arenaIndexCounter = 0;

    const rootNode: TrieNode = {
      id: nodeIdCounter++,
      edgeLabel: '<ROOT>',
      isTerminal: false,
      arenaIndex: arenaIndexCounter++,
      children: [],
    };

    let totalRawBytes = 0;

    function insert(node: TrieNode, word: string, symbol: SymbolEntry) {
      totalRawBytes += word.length + 1;

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const edge = child.edgeLabel;

        let common = 0;
        while (common < edge.length && common < word.length && edge[common] === word[common]) {
          common++;
        }

        if (common > 0) {
          if (common === edge.length) {
            if (common === word.length) {
              child.isTerminal = true;
              child.symbolName = symbol.name;
              child.symbolType = symbol.type;
              return;
            }
            insert(child, word.slice(common), symbol);
            return;
          } else {
            const splitNode: TrieNode = {
              id: nodeIdCounter++,
              edgeLabel: edge.slice(0, common),
              isTerminal: common === word.length,
              symbolName: common === word.length ? symbol.name : undefined,
              symbolType: common === word.length ? symbol.type : undefined,
              arenaIndex: arenaIndexCounter++,
              children: [],
            };

            child.edgeLabel = edge.slice(common);
            splitNode.children.push(child);
            node.children[i] = splitNode;

            if (common < word.length) {
              splitNode.children.push({
                id: nodeIdCounter++,
                edgeLabel: word.slice(common),
                isTerminal: true,
                symbolName: symbol.name,
                symbolType: symbol.type,
                arenaIndex: arenaIndexCounter++,
                children: [],
              });
            }
            return;
          }
        }
      }

      node.children.push({
        id: nodeIdCounter++,
        edgeLabel: word,
        isTerminal: true,
        symbolName: symbol.name,
        symbolType: symbol.type,
        arenaIndex: arenaIndexCounter++,
        children: [],
      });
    }

    symbols.forEach((sym) => {
      insert(rootNode, sym.name, sym);
    });

    function countEdgeBytes(node: TrieNode): number {
      let count = node.id === 0 ? 0 : node.edgeLabel.length;
      for (const ch of node.children) {
        count += countEdgeBytes(ch);
      }
      return count;
    }

    const deduplicatedBytes = countEdgeBytes(rootNode);

    return {
      root: rootNode,
      totalNodes: arenaIndexCounter,
      totalDeduplicatedBytes: deduplicatedBytes,
      rawStringBytes: totalRawBytes,
    };
  }, [symbols]);

  const prefixSavedBytes = Math.max(0, rawStringBytes - totalDeduplicatedBytes);

  const renderTrieBranch = (node: TrieNode, depth = 0) => {
    const isSelected = selectedNode?.id === node.id;

    return (
      <div key={node.id} className="flex flex-col items-center">
        {/* Node Box */}
        <div
          onClick={() => setSelectedNode(node)}
          className={`cursor-pointer rounded-lg px-3 py-2 border-2 transition-all duration-150 select-none flex flex-col items-center min-w-[105px] text-center shadow-xs ${
            node.id === 0
              ? 'bg-white border-slate-400 text-slate-900 font-bold'
              : node.isTerminal
              ? isSelected
                ? 'bg-orange-100 border-orange-600 text-orange-950 ring-2 ring-orange-500/40'
                : 'bg-orange-50 border-orange-300 text-orange-950 hover:border-orange-500'
              : isSelected
              ? 'bg-teal-100 border-teal-700 text-teal-950 ring-2 ring-teal-500/40'
              : 'bg-teal-50 border-teal-300 text-teal-950 hover:border-teal-500'
          }`}
        >
          {/* Edge Label / Prefix */}
          <div className="flex items-center space-x-1 font-mono font-bold text-xs">
            {node.id === 0 ? (
              <span className="text-slate-600 font-black">ROOT</span>
            ) : (
              <span className="font-extrabold text-slate-900">"{node.edgeLabel}"</span>
            )}
          </div>

          {/* Arena Index / Leaf Tag */}
          <div className="flex items-center space-x-1 mt-1 text-[10px] font-mono font-bold">
            <span className="px-1.5 py-0.2 rounded bg-white border border-slate-300 text-slate-700">
              arena[{node.arenaIndex}]
            </span>
            {node.isTerminal && (
              <span className="px-1 rounded bg-orange-200 text-orange-950 font-black border border-orange-300">
                sym
              </span>
            )}
          </div>

          {node.symbolType && (
            <span className="text-[10px] text-teal-900 font-mono font-bold mt-0.5">
              {node.symbolType}
            </span>
          )}
        </div>

        {/* Children Branches */}
        {node.children.length > 0 && (
          <div className="flex flex-col items-center w-full">
            <div className="w-0.5 h-6 bg-slate-400" />
            <div className="relative flex justify-center gap-4 sm:gap-6 pt-0">
              {node.children.length > 1 && (
                <div
                  className="absolute top-0 h-0.5 bg-slate-400"
                  style={{
                    left: `calc(100% / ${node.children.length * 2})`,
                    right: `calc(100% / ${node.children.length * 2})`,
                  }}
                />
              )}

              {node.children.map((child) => (
                <div key={child.id} className="flex flex-col items-center">
                  <div className="w-0.5 h-4 bg-slate-400" />
                  {renderTrieBranch(child, depth + 1)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (symbols.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border-2 border-slate-300 bg-white overflow-hidden shadow-xs">
      {/* Header Bar */}
      <div className="p-4 border-b-2 border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Network className="w-5 h-5 text-teal-800" />
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Radix (Patricia) Trie Visualizer
            </h3>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-teal-100 text-teal-900 border border-teal-300">
              Prefix Intern Table
            </span>
          </div>
          <p className="text-xs text-slate-600 font-medium mt-0.5">
            Edges represent compacted prefix strings interned in contiguous 16-bit indexed arena blocks.
          </p>
        </div>

        {/* Quick Zoom & Reset Controls */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.15))}
            className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border-2 border-slate-300 transition-colors shadow-2xs font-bold"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono font-bold text-slate-900 min-w-[44px] text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(1.4, z + 0.15))}
            className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border-2 border-slate-300 transition-colors shadow-2xs font-bold"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoomLevel(1)}
            className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border-2 border-slate-300 transition-colors shadow-2xs font-bold"
            title="Reset Zoom"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="px-4 py-3 bg-white border-b-2 border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs font-mono font-bold text-slate-800">
        <div className="flex items-center space-x-5">
          <div>
            <span className="text-slate-500 font-medium">Arena Nodes:</span>{' '}
            <span className="text-teal-900 font-black">{totalNodes}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Prefix Characters Spared:</span>{' '}
            <span className="text-orange-600 font-black">{prefixSavedBytes} chars</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Edge Storage:</span>{' '}
            <span className="text-slate-900 font-black">{totalDeduplicatedBytes} B</span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 font-sans text-slate-600 text-xs font-medium">
          <Info className="w-3.5 h-3.5 text-teal-800" />
          <span>Click any node to inspect prefix edge chunk & arena index</span>
        </div>
      </div>

      {/* Node Inspector Drawer if selected */}
      {selectedNode && (
        <div className="px-4 py-2.5 bg-teal-50 border-b-2 border-teal-300 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-3.5 font-medium">
            <span className="font-bold text-teal-950">
              Selected Edge: <code className="bg-white border-2 border-teal-300 px-2 py-0.5 rounded text-teal-950 font-black">"{selectedNode.edgeLabel}"</code>
            </span>
            <span className="text-slate-700 font-mono">
              Arena Index: <code className="text-teal-900 font-black">arena[{selectedNode.arenaIndex}]</code> (16-bit uint)
            </span>
            {selectedNode.isTerminal && selectedNode.symbolName && (
              <span className="text-orange-800 font-mono flex items-center space-x-1 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-orange-600" />
                <span>Full Symbol: <strong className="text-orange-950 font-black">{selectedNode.symbolName}</strong> ({selectedNode.symbolType})</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSelectedNode(null)}
            className="text-xs text-teal-900 hover:text-black underline font-bold"
          >
            Close
          </button>
        </div>
      )}

      {/* Graph Canvas */}
      <div className="p-8 overflow-x-auto min-h-[460px] max-h-[580px] bg-slate-50/50 flex justify-center items-start">
        <div
          className="transition-transform duration-150 origin-top flex justify-center pb-8"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          {renderTrieBranch(root)}
        </div>
      </div>

      {/* Visualizer Footer Explainer */}
      <div className="p-3 bg-white border-t-2 border-slate-200 text-xs text-slate-600 flex items-center justify-between font-medium">
        <span>
          🌳 <strong className="text-slate-900 font-bold">Patricia Trie Guarantee:</strong> Common prefix characters are interned in contiguous 16-bit indexed arena nodes.
        </span>
        <span className="font-mono text-teal-900 font-black">Zero 64-bit Pointer Overhead</span>
      </div>
    </div>
  );
};
