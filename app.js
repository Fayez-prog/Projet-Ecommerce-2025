const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const path = require('path'); 

// Configuration de l'environnement
dotenv.config();

// Initialisation de l'application Express
const app = express();

// Middlewares
app.use(helmet()); // Sécurité HTTP
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, './client/build')));

// Validation de la configuration
if (!process.env.GEMINI_API_KEY) {
  console.error("Erreur: La clé API Gemini n'est pas configurée");
  process.exit(1);
}

// Création du modèle Gemini
const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-2.0-flash",
  temperature: 0.7,
});

// Connexion à MongoDB avec gestion des erreurs améliorée
const mongoURI = process.env.DATABASECLOUD;
mongoose.connect(mongoURI)
  .then(() => console.log("Connexion à MongoDB réussie"))
  .catch(err => {
    console.error("Erreur de connexion à MongoDB:", err);
    process.exit(1);
  });

// Routes pour les entités métier
const userRouter = require("./routes/user.route");
const categorieRouter = require('./routes/categorie.route');
const scategorieRouter = require('./routes/scategorie.route');
const articleRouter = require('./routes/article.route');
const paymentRouter = require('./routes/payment.route');
const orderRouter = require("./routes/order.route");

app.use('/api/users', userRouter);
app.use('/api/categories', categorieRouter);
app.use('/api/scategories', scategorieRouter);
app.use('/api/articles', articleRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/orders', orderRouter);

/**
 * Récupère les collections disponibles dans la base de données
 * @returns {Promise<string[]>} Tableau des noms de collections
 */
async function getCollections() {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    return collections.map(col => col.name);
  } catch (error) {
    console.error("Erreur lors de la récupération des collections:", error);
    return [];
  }
}

/**
 * Extrait un objet JSON à partir d'une chaîne de texte
 * @param {string} text - Texte contenant potentiellement du JSON
 * @returns {object|null} Objet JSON extrait ou null si échec
 */
function extractJSON(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("Aucun JSON détecté");
    const jsonStr = text.substring(start, end + 1);
    return JSON.parse(jsonStr);
  } catch (err) {
    console.warn("Erreur lors de l'extraction du JSON:", err.message);
    return null;
  }
}

/**
 * Analyse l'intention de l'utilisateur et génère une requête MongoDB
 * @param {string} userQuestion - Question posée par l'utilisateur
 * @returns {Promise<object>} Objet contenant l'intention, la collection et la requête
 */
async function analyzeIntent(userQuestion) {
  const availableCollections = await getCollections();
  console.log("Collections disponibles:", availableCollections);
  
  const prompt = `
    Tu es un assistant qui analyse des questions en français et génère des requêtes MongoDB.
    Collections disponibles: ${availableCollections.join(", ")}.
    Réponds uniquement avec un objet JSON comme :
    {
      "intent": "list|search|aggregate",
      "collection": "nom_collection",
      "query": {}
    }
    Pour un maximum, utilise :
    {
      "intent": "aggregate",
      "collection": "nom_collection",
      "query": [
        { "$sort": { "qtestock": -1 } },
        { "$limit": 1 }
      ]
    }
    Pour obtenir des informations liées à une sous-catégorie via le champ scategorieID, utilise :
    {
      "intent": "aggregate",
      "collection": "articles",
      "query": [
        {
          "$lookup": {
          "from": "scategories",
          "localField": "scategorieID",
          "foreignField": "_id",
          "as": "scategorie"
          }
        },
        { "$unwind": "$scategorie" },
        {
          "$project": {
          "_id": 0,
          "designation": 1,
          "prix": 1,
          "qtestock": 1,
          "imageart": 1,
          "nomscategorie": "$scategorie.nomscategorie"
          }
        }
      ]
    }

    Question: ${userQuestion}
  `;
  
  try {
    console.log("Envoi du prompt à Gemini...");
    const response = await model.call([new HumanMessage(prompt)]);
    console.log("Réponse brute du modèle:", response.content);
    const analysis = extractJSON(response.content);
    
    if (!analysis) throw new Error("Réponse du modèle non analysable");
    
    // Validation de la collection
    if (!analysis.collection || !availableCollections.includes(analysis.collection)) {
      console.warn("Collection invalide ou non spécifiée:", analysis.collection);
      analysis.collection = availableCollections.includes("articles") ? "articles" : availableCollections[0];
      console.log("Utilisation de la collection par défaut:", analysis.collection);
    }
    
    // Validation de l'intention
    if (!["list", "search", "aggregate"].includes(analysis.intent)) {
      analysis.intent = "list";
    }
    
    return analysis;
  } catch (error) {
    console.error("Erreur lors de l'analyse:", error.message);
    return {
      intent: "list",
      collection: availableCollections.includes("articles") ? "articles" : availableCollections[0],
      query: {},
    };
  }
}

/**
 * Exécute une requête MongoDB en fonction de l'analyse d'intention
 * @param {object} analysis - Analyse de l'intention
 * @returns {Promise<array>} Résultats de la requête
 */
async function executeMongoQuery(analysis) {
  const db = mongoose.connection.db;
  const collection = db.collection(analysis.collection);
  
  try {
    if (analysis.intent === "aggregate" && Array.isArray(analysis.query)) {
      return await collection.aggregate(analysis.query).toArray();
    } else if (analysis.intent === "search" || analysis.intent === "list") {
      return await collection.find(analysis.query).toArray();
    }
    throw new Error("Type de requête non supporté");
  } catch (err) {
    console.error("Erreur lors de l'exécution de la requête:", err);
    throw err;
  }
}

// Endpoint pour le chatbot intelligent avec MongoDB
app.post("/api/chatbot", async (req, res, next) => {
  try {
    if (!req.body.question) {
      return res.status(400).json({ error: "Le champ 'question' est requis" });
    }

    const { question } = req.body;
    console.log("Question reçue:", question);
    
    const analysis = await analyzeIntent(question);
    const results = await executeMongoQuery(analysis);
    
    res.json({
      question,
      analysis,
      resultats: results,
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint pour le chatbot conversationnel simple
app.post("/api/chat", async (req, res, next) => {
  try {
    if (!req.body.message) {
      return res.status(400).json({ error: "Le champ 'message' est requis" });
    }

    const userMessage = req.body.message;
    const response = await model.call([
      new HumanMessage(userMessage),
    ]);
    res.json({ reply: response.content });
  } catch (err) {
    next(err);
  }
});

// Gestion des erreurs centralisée
app.use((err, req, res, next) => {
  console.error("Erreur:", err.stack);
  res.status(500).json({
    error: "Une erreur est survenue",
    message: err.message
  });
});

// Route pour les pages non trouvées, redirige vers index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, './client/build/index.html'));
});

// Démarrer le serveur
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
});

module.exports = app;