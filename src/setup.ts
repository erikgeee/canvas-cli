import { access, chmod, writeFile } from "node:fs/promises"
import process from "node:process"
import { createInterface } from "node:readline/promises"
import { envFileContents } from "./setup-config.js"

const envPath = new URL("../.env", import.meta.url)

async function fileExists() {
  try {
    await access(envPath)
    return true
  } catch {
    return false
  }
}

function readHidden(prompt: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Kör npm run setup i en interaktiv terminal.")
  }

  return new Promise<string>((resolve, reject) => {
    const input = process.stdin
    const previousRawMode = input.isRaw
    let value = ""

    const finish = (error?: Error) => {
      input.off("data", onData)
      input.setRawMode(previousRawMode)
      input.pause()
      process.stdout.write("\n")
      if (error) reject(error)
      else resolve(value)
    }

    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") return finish(new Error("Konfigurationen avbröts."))
        if (character === "\r" || character === "\n") return finish()
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1)
        else if (character >= " " && character !== "\u001b") value += character
      }
    }

    process.stdout.write(prompt)
    input.setEncoding("utf8")
    input.setRawMode(true)
    input.resume()
    input.on("data", onData)
  })
}

async function main() {
  const readline = createInterface({ input: process.stdin, output: process.stdout })

  if (await fileExists()) {
    const overwrite = await readline.question(".env finns redan. Skriva över den? (j/N): ")
    if (overwrite.trim().toLocaleLowerCase("sv") !== "j") {
      readline.close()
      console.log("Ingen konfiguration ändrades.")
      return
    }
  }

  const enteredBaseUrl = await readline.question("Canvas-adress [https://canvas.kth.se]: ")
  readline.close()
  const token = await readHidden("Personlig Canvas-token (dold inmatning): ")
  const contents = envFileContents(enteredBaseUrl || "https://canvas.kth.se", token)

  await writeFile(envPath, contents, { encoding: "utf8", mode: 0o600 })
  await chmod(envPath, 0o600)
  console.log("Konfigurationen sparades lokalt i .env med privata filrättigheter.")
  console.log("Kontrollera anslutningen med: npm run check-token")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Konfigurationen misslyckades.")
  process.exitCode = 1
})
