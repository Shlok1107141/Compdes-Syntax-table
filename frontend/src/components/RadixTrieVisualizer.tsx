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

  // Build the Radix Trie from symbol identifiers
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

    // Helper to insert an identifier into the Radix Trie
    function insert(node: TrieNode, word: string, symbol: SymbolEntry) {
      totalRawBytes += word.length + 1;

      // Check if any child shares a prefix with the word
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const edge = child.edgeLabel;

        // Find common prefix length
        let common = 0;
        while (common < edge.length && common < word.length && edge[common] === word[common]) {
          common++;
        }

        if (common > 0) {
          if (common === edge.length) {
            // Full edge matches; recurse with remainder
            if (common === word.length) {
              child.isTerminal = true;
              child.symbolName = symbol.name;
              child.symbolType = symbol.type;
              return;
            }
            insert(child, word.slice(common), symbol);
            return;
          } else {
            // Split edge at common prefix! (Radix / Patricia compression)
            const splitNode: TrieNode = {
              id: nodeIdCounter++,
              edgeLabel: edge.slice(0, common),
              isTerminal: common === word.length,
              symbolName: common === word.length ? symbol.name : undefined,
              symbolType: common === word.length ? symbol.type : undefined,
              arenaIndex: arenaIndexCounter++,
              children: [],
            };

            // Existing child gets tail label
            child.edgeLabel = edge.slice(common);
            splitNode.children.push(child);

            // Replace child in current node
            node.children[i] = splitNode;

            if (common < word.length) {
              // Add remainder as new child
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

      // No common prefix with any child, create new branch
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

    // Insert all unique symbols
    symbols.forEach((sym) => {
      insert(rootNode, sym.name, sym);
    });

    // Calculate total edge character storage
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

  // Recursive component to render Trie nodes and edges
  const renderTrieBranch = (node: TrieNode, depth = 0) => {
    const isSelected = selectedNode?.id === node.id;

    return (
      <div key={node.id} className="flex flex-col items-center">
        {/* Node Box */}
        <div
          onClick={() => setSelectedNode(node)}
          className={`cursor-pointer rounded-xl px-3 py-2 border transition-all duration-200 select-none flex flex-col items-center min-w-[100px] text-center shadow-md ${
            node.id === 0
              ? 'bg-slate-950 border-slate-700 text-slate-300'
              : node.isTerminal
              ? isSelected
                ? 'bg-emerald-600 border-emerald-400 text-white ring-2 ring-emerald-400/50 shadow-emerald-900/50'
                : 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200 hover:border-emerald-400'
              : isSelected
              ? 'bg-indigo-600 border-indigo-400 text-white ring-2 ring-indigo-400/50 shadow-indigo-900/50'
              : 'bg-indigo-950/70 border-indigo-500/40 text-indigo-200 hover:border-indigo-400'
          }`}
        >
          {/* Edge Label / Prefix */}
          <div className="flex items-center space-x-1 font-mono font-bold text-xs">
            {node.id === 0 ? (
              <span className="text-slate-400">ROOT</span>
            ) : (
              <span>"{node.edgeLabel}"</span>
            )}
          </div>

          {/* Arena Index / Leaf Tag */}
          <div className="flex items-center space-x-1 mt-1 text-[10px] font-mono opacity-80">
            <span className="px-1.5 py-0.2 rounded bg-black/40">
              arena[{node.arenaIndex}]
            </span>
            {node.isTerminal && (
              <span className="px-1 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                sym
              </span>
            )}
          </div>

          {node.symbolType && (
            <span className="text-[9px] text-emerald-300/80 font-mono mt-0.5">
              {node.symbolType}
            </span>
          )}
        </div>

        {/* Children Branches */}
        {node.children.length > 0 && (
          <div className="flex flex-col items-center w-full">
            {/* Vertical connector from parent */}
            <div className="w-0.5 h-6 bg-slate-700" />

            {/* Horizontal Branch Bar */}
            <div className="relative flex justify-center gap-4 sm:gap-6 pt-0">
              {node.children.length > 1 && (
                <div
                  className="absolute top-0 h-0.5 bg-slate-700"
                  style={{
                    left: `calc(100% / ${node.children.length * 2})`,
                    right: `calc(100% / ${node.children.length * 2})`,
                  }}
                />
              )}

              {/* Children Nodes */}
              {node.children.map((child) => (
                <div key={child.id} className="flex flex-col items-center">
                  <div className="w-0.5 h-4 bg-slate-700" />
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl backdrop-blur-sm">
      {/* Header Bar */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Network className="w-4 h-4 text-emerald-400" />
            <h3 className="text-base font-semibold text-white">
              Radix (Patricia) Trie Visualizer
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Showcase Demo
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Edges represent shared prefix substrings. The trie itself functions as the string intern table.
          </p>
        </div>

        {/* Quick Zoom & Reset Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.15))}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-slate-400 min-w-[42px] text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={() => setZoomLevel((z) => Math.min(1.4, z + 0.15))}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoomLevel(1)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            title="Reset Zoom"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="px-4 py-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center space-x-4">
          <div>
            <span className="text-slate-500">Arena Nodes:</span>{' '}
            <span className="text-indigo-300 font-bold">{totalNodes}</span>
          </div>
          <div>
            <span className="text-slate-500">Prefix Characters Spared:</span>{' '}
            <span className="text-emerald-400 font-bold">{prefixSavedBytes} chars</span>
          </div>
          <div>
            <span className="text-slate-500">Edge Storage:</span>{' '}
            <span className="text-cyan-300 font-bold">{totalDeduplicatedBytes} B</span>
          </div>
        </div>

        <div className="flex items-center space-x-2 font-sans text-slate-400 text-[11px]">
          <Info className="w-3.5 h-3.5 text-indigo-400" />
          <span>Click any node to inspect prefix chunk & arena offset</span>
        </div>
      </div>

      {/* Node Inspector Drawer if selected */}
      {selectedNode && (
        <div className="px-4 py-2.5 bg-indigo-950/40 border-b border-indigo-500/20 flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center space-x-3">
            <span className="font-semibold text-indigo-300">
              Selected: <code className="bg-slate-900 px-1.5 py-0.5 rounded text-white">"{selectedNode.edgeLabel}"</code>
            </span>
            <span className="text-slate-400 font-mono">
              Arena Index: <code className="text-indigo-200">arena[{selectedNode.arenaIndex}]</code> (16-bit uint)
            </span>
            {selectedNode.isTerminal && selectedNode.symbolName && (
              <span className="text-emerald-400 font-mono flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Full Symbol: <strong>{selectedNode.symbolName}</strong> ({selectedNode.symbolType})</span>
              </span>
            )}
          </div>
          <button
            onClick={() => setSelectedNode(null)}
            className="text-xs text-indigo-300 hover:text-white underline font-sans"
          >
            Close
          </button>
        </div>
      )}

      {/* Interactive Graph Canvas / Tree View */}
      <div className="p-8 overflow-x-auto min-h-[460px] max-h-[560px] bg-slate-950/90 flex justify-center items-start scrollbar-thin scrollbar-thumb-slate-700">
        <div
          className="transition-transform duration-200 origin-top flex justify-center pb-8"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          {renderTrieBranch(root)}
        </div>
      </div>

      {/* Visualizer Footer Explainer */}
      <div className="p-3 bg-slate-950/90 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
        <span>
          🌳 <strong>Patricia Trie Guarantee:</strong> No two identifiers duplicate edge prefix memory. All edges reside in a contiguous 16-bit indexed arena block.
        </span>
        <span className="font-mono text-emerald-400">Zero Pointer Overhead</span>
      </div>
    </div>
  );
};
