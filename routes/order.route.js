const express = require('express');
const router = express.Router();
const Order = require('../models/order.js');

/**
 * @route POST /api/orders
 * @desc Créer une nouvelle commande
 * @access Public
 */
router.post('/', async (req, res) => {
    const commandeData = req.body;
    
    try {
        // Calcul du total de la commande
        const mtcmd = commandeData.lineOrder.reduce((acc, lc) => acc + lc.totalPrice, 0);

        // Création de la nouvelle commande
        const newOrder = new Order({
            client: commandeData.client,
            total: parseFloat(mtcmd).toFixed(3),
            status: 'Not processed',
            lineOrder: commandeData.lineOrder.map((lc) => ({
                articleID: lc.articleID,
                quantity: lc.quantity,
                totalPrice: lc.totalPrice
            }))
        });

        // Sauvegarde en base de données
        await newOrder.save();

        // Réponse avec la commande créée
        res.status(200).json({ 
            message: 'Commande créée avec succès', 
            order: newOrder 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            message: 'Erreur lors de la création de la commande',
            error: error.message 
        });
    }
});

/**
 * @route GET /api/orders
 * @desc Récupérer toutes les commandes (triées par date décroissante)
 * @access Public
 */
router.get('/', async (req, res) => {
    try {
        const orders = await Order.find({})
                                .sort({ '_id': -1 }) // Tri par ID décroissant (plus récent en premier)
                                .populate("lineOrder.articleID") // Peuplement des données des articles
                                .exec();
        
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ 
            message: 'Erreur lors de la récupération des commandes',
            error: error.message 
        });
    }
});

/**
 * @route PUT /api/orders/:id
 * @desc Mettre à jour le statut d'une commande
 * @access Public
 */
router.put('/:id', async (req, res) => {
    const newStatus = req.body.status;
    const orderId = req.params.id;
    
    // Validation du statut
    const validStatuses = ['Not processed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!validStatuses.includes(newStatus)) {
        return res.status(400).json({ 
            message: 'Statut invalide',
            validStatuses: validStatuses 
        });
    }

    try {
        const orderUpdated = await Order.findByIdAndUpdate(
            orderId,
            { status: newStatus },
            { new: true } // Retourne le document mis à jour
        ).populate("lineOrder.articleID");
        
        if (!orderUpdated) {
            return res.status(404).json({ 
                message: 'Commande non trouvée' 
            });
        }

        res.status(200).json(orderUpdated);
    } catch (error) {
        res.status(500).json({ 
            message: 'Erreur lors de la mise à jour de la commande',
            error: error.message 
        });
    }
});

/**
 * @route DELETE /api/orders/:id
 * @desc Supprimer une commande
 * @access Public
 */
router.delete('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const deletedOrder = await Order.findByIdAndDelete(id);
        
        if (!deletedOrder) {
            return res.status(404).json({ 
                message: 'Commande non trouvée' 
            });
        }

        res.json({ 
            message: "Commande supprimée avec succès",
            deletedOrderId: id 
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Erreur lors de la suppression de la commande',
            error: error.message 
        });
    }
});

module.exports = router;