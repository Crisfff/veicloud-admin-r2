import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command
} from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_MOVIES_BUCKET,
  R2_SERIES_BUCKET,
  R2_MOVIES_PUBLIC_URL,
  R2_SERIES_PUBLIC_URL
} = process.env;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

app.use(express.static(path.join(__dirname, "public")));

function cleanName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

app.get("/api/series", async (req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: R2_SERIES_BUCKET,
      Delimiter: "/"
    });

    const data = await s3.send(command);

    const series = (data.CommonPrefixes || []).map(item =>
      item.Prefix.replace("/", "")
    );

    res.json({
      success: true,
      series
    });
  } catch (error) {
    console.error("Error listando series:", error);
    res.status(500).json({
      success: false,
      message: "No se pudieron cargar las series."
    });
  }
});

app.post("/api/create-upload-url", async (req, res) => {
  try {
    const {
      mode,
      title,
      fileName,
      contentType,
      season,
      episode
    } = req.body;

    if (!mode || !title || !fileName || !contentType) {
      return res.status(400).json({
        success: false,
        message: "Faltan datos obligatorios."
      });
    }

    const safeTitle = cleanName(title);
    const safeFileName = cleanName(fileName);

    let bucket;
    let publicBaseUrl;
    let key;

    if (mode === "movie") {
      bucket = R2_MOVIES_BUCKET;
      publicBaseUrl = R2_MOVIES_PUBLIC_URL;
      key = `${safeTitle}/${Date.now()}-${safeFileName}`;
    } else if (mode === "series") {
      if (!season || !episode) {
        return res.status(400).json({
          success: false,
          message: "En series debes indicar temporada y capítulo."
        });
      }

      bucket = R2_SERIES_BUCKET;
      publicBaseUrl = R2_SERIES_PUBLIC_URL;

      const safeSeason = cleanName(`temporada-${season}`);
      const safeEpisode = cleanName(`capitulo-${episode}`);

      key = `${safeTitle}/${safeSeason}/${safeEpisode}-${Date.now()}-${safeFileName}`;
    } else {
      return res.status(400).json({
        success: false,
        message: "Modo inválido."
      });
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 60 * 60
    });

    const playbackUrl = `${publicBaseUrl}/${key}`;

    res.json({
      success: true,
      uploadUrl,
      playbackUrl,
      key
    });
  } catch (error) {
    console.error("Error creando upload url:", error);
    res.status(500).json({
      success: false,
      message: "Error creando URL segura de subida."
    });
  }
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "VeiCloud Admin activo"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`VeiCloud Admin running on port ${PORT}`);
});
