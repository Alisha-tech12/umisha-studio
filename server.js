const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS categories (
            id SERIAL PRIMARY KEY,
            slug TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            icon TEXT DEFAULT '🎁',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            base_price INTEGER NOT NULL,
            sample_image_url TEXT,
            custom_options TEXT,
            themes TEXT,
            stock INTEGER DEFAULT 100,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            order_number TEXT UNIQUE NOT NULL,
            user_email TEXT NOT NULL,
            user_name TEXT NOT NULL,
            user_phone TEXT,
            total_amount INTEGER NOT NULL,
            status TEXT DEFAULT 'Pending',
            shipping_address TEXT NOT NULL,
            tracking_number TEXT,
            estimated_delivery TEXT,
            admin_notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL,
            product_id INTEGER,
            product_name TEXT NOT NULL,
            quantity INTEGER DEFAULT 1,
            unit_price INTEGER NOT NULL,
            selected_size TEXT,
            selected_design TEXT,
            selected_color TEXT,
            selected_theme TEXT,
            selected_addons TEXT,
            uploaded_image_path TEXT,
            engraving_text TEXT,
            FOREIGN KEY(order_id) REFERENCES orders(id)
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Insert default admin
        const adminEmail = 'umishastudio@gmail.com';
        const adminPassword = bcrypt.hashSync('UmishaStudio@Alhamdulillah', 10);
        const existingAdmin = await client.query(`SELECT * FROM users WHERE email = $1`, [adminEmail]);
        if (existingAdmin.rows.length === 0) {
            await client.query(`INSERT INTO users (email, password, role) VALUES ($1, $2, $3)`, [adminEmail, adminPassword, 'admin']);
        }

        // Insert default categories
        const defaultCategories = [
            { slug: 'photo_frames', name: 'Photo Frames', icon: '🖼️' },
            { slug: 'gift_bouquets', name: 'Gift Bouquets', icon: '💐' },
            { slug: 'magazines', name: 'Magazines', icon: '📖' },
            { slug: 'scrunchies', name: 'Scrunchies', icon: '🎀' },
            { slug: 'arm_cuffs', name: 'Arm Cuffs', icon: '💪' },
        ];
        for (const cat of defaultCategories) {
            await client.query(`INSERT INTO categories (slug, name, icon) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`, [cat.slug, cat.name, cat.icon]);
        }

        // Insert sample products
        const sampleProducts = [
            { name: 'Custom Photo Frame', category: 'photo_frames', base_price: 1500, stock: 50, sample_image_url: 'https://images.unsplash.com/photo-1563865436874-9aef32099f9d?w=400', custom_options: JSON.stringify({ sizes: [{ name: '4x6 inches', price: 0 }, { name: '5x7 inches', price: 700 }, { name: '8x10 inches', price: 1500 }], designs: [{ name: 'Classic Wood', price: 0 }, { name: 'Metallic Gold', price: 500 }, { name: 'Rustic White', price: 300 }], engravable: true }), themes: JSON.stringify(['Birthday', 'Wedding', 'Graduation']) },
            { name: 'Birthday Gift Bouquet', category: 'gift_bouquets', base_price: 2500, stock: 30, sample_image_url: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=400', custom_options: JSON.stringify({ addons: [{ name: 'Chocolate Box', price: 400 }, { name: 'Teddy Bear', price: 600 }, { name: 'Balloon Bundle', price: 300 }] }), themes: JSON.stringify(['Birthday', 'Wedding', 'Graduation']) },
            { name: 'Pink Silk Scrunchie', category: 'scrunchies', base_price: 400, stock: 200, sample_image_url: 'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?w=400', custom_options: JSON.stringify({ colors: [{ name: 'Blush Pink', price: 0 }, { name: 'Sage Green', price: 0 }], sizes: ['One Size', 'Kids', 'Adult'] }), themes: JSON.stringify([]) },
            { name: 'Wedding Gift Basket', category: 'gift_bouquets', base_price: 3500, stock: 20, sample_image_url: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=400', custom_options: JSON.stringify({ addons: [{ name: 'Personalized Card', price: 150 }, { name: 'Chocolate Box', price: 400 }, { name: 'Teddy Bear', price: 600 }] }), themes: JSON.stringify(['Wedding', 'Anniversary']) },
            { name: 'Custom Magazine', category: 'magazines', base_price: 2000, stock: 40, sample_image_url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400', custom_options: JSON.stringify({ page_counts: [{ name: '6 pages', price: 0 }, { name: '8 pages', price: 500 }, { name: '12 pages', price: 1200 }], cover_types: [{ name: 'Soft Cover', price: 0 }, { name: 'Hard Cover', price: 800 }, { name: 'Leather Cover', price: 1500 }], max_uploads: 20 }), themes: JSON.stringify(['Birthday', 'Wedding', 'Graduation']) },
            { name: 'Aqua Scrunchie Set', category: 'scrunchies', base_price: 400, stock: 150, sample_image_url: 'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=400', custom_options: JSON.stringify({ colors: [{ name: 'Aqua Marine', price: 0 }, { name: 'Ocean Blue', price: 0 }], sizes: ['One Size', 'Kids', 'Adult'] }), themes: JSON.stringify([]) },
            { name: 'Bohemian Arm Cuff', category: 'arm_cuffs', base_price: 900, stock: 60, sample_image_url: 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?w=400', custom_options: JSON.stringify({ colors: [{ name: 'Gold', price: 0 }, { name: 'Silver', price: 0 }], sizes: ['Small', 'Medium', 'Large'] }), themes: JSON.stringify([]) },
            { name: 'Graduation Frame', category: 'photo_frames', base_price: 2200, stock: 35, sample_image_url: 'https://images.unsplash.com/photo-1563865436874-9aef32099f9d?w=400', custom_options: JSON.stringify({ sizes: [{ name: '4x6 inches', price: 0 }, { name: '5x7 inches', price: 700 }, { name: '8x10 inches', price: 1500 }], designs: [{ name: 'Classic Wood', price: 0 }, { name: 'Metallic Gold', price: 500 }] }), themes: JSON.stringify(['Graduation']) },
        ];
        for (const product of sampleProducts) {
            const existing = await client.query(`SELECT * FROM products WHERE name = $1`, [product.name]);
            if (existing.rows.length === 0) {
                await client.query(`INSERT INTO products (name, category, base_price, sample_image_url, custom_options, themes, stock) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [product.name, product.category, product.base_price, product.sample_image_url, product.custom_options, product.themes, product.stock]);
            }
        }

        console.log('✅ Database initialized successfully');
    } finally {
        client.release();
    }
}

function generateOrderNumber() {
    return `UMI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'umishastudio_secret_key_2024');
        req.user = decoded;
        next();
    } catch(e) {
        res.status(403).json({ error: 'Invalid token' });
    }
}

// Public APIs
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM products ORDER BY id`);
        const products = result.rows.map(p => {
            try { if (p.custom_options) p.custom_options = JSON.parse(p.custom_options); } catch(e) {}
            try { if (p.themes) p.themes = JSON.parse(p.themes); } catch(e) {}
            return p;
        });
        res.json(products);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM categories ORDER BY id`);
        res.json(result.rows);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM products WHERE id = $1`, [req.params.id]);
        const product = result.rows[0];
        if (product) {
            try { product.custom_options = JSON.parse(product.custom_options); } catch(e) {}
            try { product.themes = JSON.parse(product.themes); } catch(e) {}
        }
        res.json(product);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/orders', async (req, res) => {
    const { user_name, user_email, user_phone, shipping_address, items, total_amount } = req.body;
    const order_number = generateOrderNumber();
    const estimated_delivery = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderResult = await client.query(
            `INSERT INTO orders (order_number, user_email, user_name, user_phone, total_amount, status, shipping_address, estimated_delivery) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [order_number, user_email, user_name, user_phone || null, total_amount, 'Pending', shipping_address, estimated_delivery]
        );
        const orderId = orderResult.rows[0].id;
        for (const item of items) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, selected_size, selected_design, selected_color, selected_theme, selected_addons, uploaded_image_path, engraving_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                [orderId, item.product_id, item.product_name, item.quantity, item.unit_price,
                 item.selected_size||null, item.selected_design||null, item.selected_color||null,
                 item.selected_theme||null, JSON.stringify(item.selected_addons||[]),
                 item.uploaded_images?item.uploaded_images[0]:null, item.engraving_text||null]
            );
            if (item.product_id) {
                await client.query(`UPDATE products SET stock = GREATEST(0, stock - $1) WHERE id = $2`, [item.quantity, item.product_id]);
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, order_number, estimated_delivery });
    } catch(err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/track-order', async (req, res) => {
    const { order_number, email } = req.body;
    try {
        const orderResult = await pool.query(`SELECT * FROM orders WHERE order_number = $1 AND user_email = $2`, [order_number, email]);
        if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
        const order = orderResult.rows[0];
        const itemsResult = await pool.query(`SELECT * FROM order_items WHERE order_id = $1`, [order.id]);
        res.json({ order, items: itemsResult.rows });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM users WHERE email = $1 AND role = 'admin'`, [email]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'umishastudio_secret_key_2024', { expiresIn: '24h' });
        res.json({ success: true, token });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin APIs (protected)
app.get('/api/admin/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await pool.query(`SELECT COUNT(*) as total_orders, COALESCE(SUM(total_amount),0) as total_sales FROM orders`);
        const pending = await pool.query(`SELECT COUNT(*) as pending_orders FROM orders WHERE status = 'Pending'`);
        const prods = await pool.query(`SELECT COUNT(*) as total_products FROM products`);
        const low = await pool.query(`SELECT COUNT(*) as low_stock FROM products WHERE stock <= 10`);
        res.json({
            total_orders: parseInt(stats.rows[0].total_orders) || 0,
            total_sales: parseInt(stats.rows[0].total_sales) || 0,
            pending_orders: parseInt(pending.rows[0].pending_orders) || 0,
            total_products: parseInt(prods.rows[0].total_products) || 0,
            low_stock_count: parseInt(low.rows[0].low_stock) || 0
        });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/orders', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/orders/:id', authMiddleware, async (req, res) => {
    try {
        const orderResult = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
        if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const order = orderResult.rows[0];
        const itemsResult = await pool.query(`SELECT * FROM order_items WHERE order_id = $1`, [order.id]);
        const items = itemsResult.rows.map(item => {
            try { item.selected_addons = JSON.parse(item.selected_addons || '[]'); } catch(e) {}
            return item;
        });
        res.json({ order, items });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/orders/:id/status', authMiddleware, async (req, res) => {
    const { status, tracking_number, admin_notes } = req.body;
    try {
        await pool.query(
            `UPDATE orders SET status = $1, tracking_number = COALESCE($2, tracking_number), admin_notes = COALESCE($3, admin_notes) WHERE id = $4`,
            [status, tracking_number || null, admin_notes || null, req.params.id]
        );
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Categories admin
app.get('/api/admin/categories', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM categories ORDER BY id`);
        res.json(result.rows);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/categories', authMiddleware, async (req, res) => {
    const { name, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    try {
        const result = await pool.query(
            `INSERT INTO categories (slug, name, icon) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING RETURNING id`,
            [slug, name, icon || '🎁']
        );
        res.json({ success: true, id: result.rows[0]?.id, slug });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/categories/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query(`DELETE FROM categories WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Products admin
app.get('/api/admin/products', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM products ORDER BY id`);
        const products = result.rows.map(p => {
            try { p.custom_options = JSON.parse(p.custom_options); } catch(e) {}
            try { p.themes = JSON.parse(p.themes); } catch(e) {}
            return p;
        });
        res.json(products);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/products', authMiddleware, upload.single('image'), async (req, res) => {
    const { name, category, base_price, custom_options, themes, product_id, stock } = req.body;
    const sample_image_url = req.file ? `/uploads/${req.file.filename}` : req.body.sample_image_url;
    try {
        if (product_id) {
            await pool.query(
                `UPDATE products SET name=$1, category=$2, base_price=$3, sample_image_url=COALESCE($4,sample_image_url), custom_options=$5, themes=$6, stock=$7 WHERE id=$8`,
                [name, category, base_price, sample_image_url||null, custom_options||'{}', themes||'[]', stock||100, product_id]
            );
            res.json({ success: true, id: product_id });
        } else {
            const result = await pool.query(
                `INSERT INTO products (name, category, base_price, sample_image_url, custom_options, themes, stock) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [name, category, base_price, sample_image_url||null, custom_options||'{}', themes||'[]', stock||100]
            );
            res.json({ success: true, id: result.rows[0].id });
        }
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/products/:id/stock', authMiddleware, async (req, res) => {
    const { stock } = req.body;
    try {
        await pool.query(`UPDATE products SET stock = $1 WHERE id = $2`, [stock, req.params.id]);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/products/:id/price', authMiddleware, async (req, res) => {
    const { base_price } = req.body;
    try {
        await pool.query(`UPDATE products SET base_price = $1 WHERE id = $2`, [base_price, req.params.id]);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/products/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query(`DELETE FROM products WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));
app.get('/track-order', (req, res) => res.sendFile(path.join(__dirname, 'views', 'track-order.html')));
app.get('/order-confirmation', (req, res) => res.sendFile(path.join(__dirname, 'views', 'order-confirmation.html')));

const fs = require('fs');
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// Start server after DB is ready
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`\n========================================`);
        console.log(`✨ UmishaStudio Server Running! ✨`);
        console.log(`========================================`);
        console.log(`📱 Website: http://localhost:${PORT}`);
        console.log(`🔐 Admin: Triple-press A on homepage`);
        console.log(`========================================\n`);
    });
}).catch(err => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
});
