import  express  from  "express" ;
import subjectsRouter from "./routes/subjects.ts";
import cors from "cors";

const app = express();
const PORT = 8000;

app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
}));

app.use(express.json());

app.use("/api/subjects", subjectsRouter);

app.get("/", (req, res) => {
    res.send("Welcome to the Classroom API!");
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});