const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const apiV1 = require('./routes/apiV1');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/v1', apiV1);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Cloud-Mikhmon RADIUS Server running on port ${PORT}`);
});
