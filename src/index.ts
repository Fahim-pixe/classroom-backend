import express from "express";

const app = express();
const port = 8000;

app.use(express.json());

app.get("/", (req, res) => {
	res.json({ message: "Server is running smoothly" });
});

app.listen(port, () => {
	console.log(`Server is running at http://localhost:${port}`);
});
