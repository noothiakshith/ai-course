import cookieParser from 'cookie-parser';
import express from 'express'
import cors from 'cors'
import authroutes from './routes/authroutes.js'
import aifeatures from './routes/airoutes.js'
import moduleroutes from './routes/moduleroutes.js'
const app = express()
app.use(cors())
app.use(cookieParser());
app.use(express.json())

app.use('/api/auth',authroutes)
app.use('/api',aifeatures)
app.use('/api',moduleroutes)
app.listen(3000,()=>{console.log("running")})