import express from "express";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from 'url';

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCUMENTS_DIR = path.join(__dirname, "documents");
const OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_MODEL = "phi";

app.use(express.json());

function buildStrictPrompt(doc1, doc2) {
  return `[INSTRUCCIONES ABSOLUTAS]
Compara estos dos contratos y devuelve SOLAMENTE un JSON con:

1. ¿Son iguales? (SI/NO)
2. Razón breve (max 5 palabras)
3. Lista de diferencias específicas

FORMATO EXACTO REQUERIDO (SOLO JSON):
{
  "igual": "SI/NO",
  "razon": "texto",
  "diferencias": ["item1", "item2"]
}

DOCUMENTO A (PLANTILLA):
${doc1}

DOCUMENTO B (COMPARAR):
${doc2}

NO INCLUYAS NADA MÁS QUE EL JSON.`;
}

app.post("/compare-simple", async (req, res) => {
  try {
    const { doc1, doc2, model = DEFAULT_MODEL } = req.body;
    
    // Validación básica
    if (!doc1 || !doc2) {
      return res.status(400).json({ error: "Se requieren ambos documentos" });
    }

    // Leer archivos
    const [docA, docB] = await Promise.all([
      fs.readFile(path.join(DOCUMENTS_DIR, doc1), "utf-8"),
      fs.readFile(path.join(DOCUMENTS_DIR, doc2), "utf-8")
    ]);

    // Configuración para Ollama (sin streaming)
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: buildStrictPrompt(docA, docB),
        format: "json",
        stream: false,  // ← Importante: desactivar streaming
        options: {
          temperature: 0,
          //num_ctx: 2048,
          seed: 123
        }
      })
    });

    const result = await response.json();
    
    if (!result.response) {
      throw new Error("El modelo no devolvió respuesta válida");
    }

    // Procesamiento de la respuesta
    let jsonResponse;
    try {
      // Extraer JSON aunque venga con texto alrededor
      const jsonMatch = result.response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No se encontró JSON en la respuesta");
      
      jsonResponse = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("Respuesta cruda recibida:", result.response);
      throw new Error(`Error parseando JSON: ${e.message}`);
    }

    // Validar estructura
    if (!jsonResponse.igual || !jsonResponse.diferencias) {
      throw new Error("Formato de respuesta inválido");
    }

    return res.json({
      success: true,
      comparacion: {
        igual: jsonResponse.igual === "SI" ? "SI" : "NO",
        razon: jsonResponse.razon || "Diferencias encontradas",
        diferencias: jsonResponse.diferencias // Máximo 3 diferencias
      }
    });

  } catch (error) {
    console.error("Error completo:", error);
    return res.status(500).json({
      error: "Error en el análisis",
      detalle: error.message,
      solucion: "1) Verifique los documentos 2) Pruebe con otro modelo 3) Revise logs"
    });
  }
});

app.listen(port, () => {
  console.log(`🟢 Servidor listo en http://localhost:${port}`);
});