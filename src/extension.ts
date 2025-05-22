import * as vscode from "vscode";
import * as path from "path";
import {
  startServer,
  stopServer,
  isServerRunning,
  getLocalIPAddress,
} from "./server";
import WebSocket from "ws";

let statusControl: vscode.StatusBarItem;
let broadcast: ((code: string) => void) | undefined;
let ws: WebSocket | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log("[Codeshare] executando.");

  const startOrStop = vscode.commands.registerCommand(
    "codeshare.toggleServer",
    async () => {
      if (isServerRunning()) {
        stopServer();
        broadcast = undefined;
      } else {
        // startWebSocketConnection();
        const server = startServer(3000);
        broadcast = server.broadcast;
        vscode.env.openExternal(vscode.Uri.parse(`http://${server.ip}:3000`));
      }
      updateStatusBar();
    }
  );

  const openBrowserCmd = vscode.commands.registerCommand(
    "codeshare.openBrowser",
    async () => {
      if (isServerRunning()) {
        const ip = getLocalIPAddress();
        vscode.env.openExternal(vscode.Uri.parse(`http://${ip}:3000`));
      }
    }
  );

  context.subscriptions.push(startOrStop, openBrowserCmd);

  statusControl = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusControl.command = "codeshare.toggleServer";
  context.subscriptions.push(statusControl);

  updateStatusBar();

  let updateTimeout: NodeJS.Timeout | null = null;

  vscode.workspace.onDidChangeTextDocument((event) => {
    if (updateTimeout) clearTimeout(updateTimeout);

    updateTimeout = setTimeout(() => {
      const document = event.document;
      const message = {
        type: "content",
        filename: vscode.workspace.asRelativePath(document.uri),
        content: document.getText(),
        language: document.languageId,
      };

      if (broadcast) broadcast(JSON.stringify(message));
    }, 300); // espera 300ms sem digitação
  });

  vscode.window.onDidChangeTextEditorSelection((event) => {
    const editor = event.textEditor;
    const selection = editor.selection;
    const document = editor.document;

    const filename = vscode.workspace.asRelativePath(document.uri);

    const selectedLines = [];
    for (let i = selection.start.line; i <= selection.end.line; i++) {
      selectedLines.push(i + 1); // linhas são baseadas em 1 no HTML
    }

    const message = {
      type: "selection",
      filename,
      selectedLines,
    };

    // Envia via WebSocket (VS Code -> navegador)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (err) {
        console.error("Erro ao enviar via WebSocket:", err);
      }
    }

    // Envia via broadcast (VS Code -> servidor local (server.ts) que repassa ao navegador)
    if (broadcast) {
      broadcast(JSON.stringify(message));
      console.log(`[Codeshare] Enviado via servidor HTTP: ${message.filename}`);
    }
  });

  vscode.workspace.onDidSaveTextDocument((document) => {
    console.log("[Codeshare] arquivo salvo, enviando...");

    sendFile(document);
  });

  // Quando um documento é aberto
  vscode.workspace.onDidOpenTextDocument((document) => {
    console.log("[Codeshare] Documento aberto.");
    const message = {
      type: "open",
      filename: vscode.workspace.asRelativePath(document.uri),
      content: document.getText(),
      language: document.languageId,
    };

    // Envia via WebSocket (VS Code -> navegador)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (err) {
        console.error("Erro ao enviar via WebSocket:", err);
      }
    }

    // Envia via broadcast (VS Code -> servidor local (server.ts) que repassa ao navegador)
    if (broadcast) {
      broadcast(JSON.stringify(message));
      console.log(`[Codeshare] Enviado via servidor HTTP: ${message.filename}`);
    }
  });

  // Quando um documento é fechado
  vscode.workspace.onDidCloseTextDocument((document) => {
    console.log("[Codeshare] Documento fechado.");
    const message = {
      type: "close",
      filename: vscode.workspace.asRelativePath(document.uri),
    };
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log("[Codeshare] Avisei que o documento foi fechado.");
      ws.send(JSON.stringify(message));
    }
    if (broadcast) {
      broadcast(JSON.stringify(message));
    }
  });
}

function sendFile(document: vscode.TextDocument) {
  const filename = vscode.workspace.asRelativePath(document.uri);
  const content = document.getText();
  const language = document.languageId;

  const message = {
    filename,
    content,
    language,
  };

  // Envia via WebSocket (VS Code -> navegador)
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
      console.log(`[Codeshare] Enviado via WebSocket: ${filename}`);
    } catch (err) {
      console.error("Erro ao enviar via WebSocket:", err);
    }
  }

  // Envia via broadcast (VS Code → servidor local que repassa ao navegador)
  if (broadcast) {
    const fallbackMessage = {
      language,
      content,
      type: "open",
      filename: path.basename(document.fileName),
    };
    broadcast(JSON.stringify(fallbackMessage));
    console.log(`[Codeshare] Enviado via servidor HTTP: ${filename}`);
  }
}

function sendAllOpenFiles(ws: WebSocket) {
  const docs = vscode.workspace.textDocuments.filter(
    (doc) => !doc.isUntitled && !doc.isClosed
  );

  for (const doc of docs) {
    sendFile(doc);
  }
}

function startWebSocketConnection() {
  ws = new WebSocket("ws://localhost:3000");

  ws.onopen = () => {
    console.log("✅ WebSocket conectado.");
    vscode.window.showInformationMessage("Codeshare conectado!");

    if (ws) sendAllOpenFiles(ws);
  };

  ws.onmessage = (event) => {
    console.log("📨 Mensagem recebida:", event.data);
  };

  ws.onerror = (error) => {
    console.error("🚨 Erro no WebSocket:", error);
    vscode.window.showErrorMessage("Erro ao conectar ao Codeshare WebSocket.");
  };

  ws.onclose = () => {
    console.warn("🔌 WebSocket desconectado.");
  };
}

function updateStatusBar() {
  if (isServerRunning()) {
    const ip = getLocalIPAddress();
    statusControl.text = `$(circle-filled) Codeshare executando em ${ip}:3000`;
    statusControl.tooltip = "Clique para parar o Codeshare";
    statusControl.color = "#4CAF50";
  } else {
    statusControl.text = `$(debug-start) Iniciar Codeshare`;
    statusControl.tooltip = "Clique para iniciar o Codeshare";
  }

  statusControl.show();
}

export function deactivate() {}
