const mongoose = require('mongoose');
const Article = require('./article.js');

const OrderSchema = new mongoose.Schema({
    client: String,
    total: {type: Number, default: 0 },
    status: {
        type: String,
        default: 'Not processed',
        enum: [
            'Not processed',
            'Processing',
            'Shipped',
            'Delivered',
            'Cancelled'
        ]
    },
    lineOrder: [{
        articleID: {
            type: mongoose.Schema.Types.ObjectId,
            ref: Article
        },
        quantity: Number,
        totalPrice: {type: Number, default: 0 }
    }]
}, {
    timestamps: true,
});

module.exports = mongoose.model('Order', OrderSchema);