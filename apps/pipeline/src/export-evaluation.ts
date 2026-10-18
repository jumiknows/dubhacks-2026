import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { buildPlaceContext } from '@emberready/domain'
import { currentReplay, loadPlaces, sourceFromSnapshot } from '../../web/src/lib/server/catalog'
import { voiceInstructions, contextTool } from '../../web/src/lib/server/voice'
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const frozen = JSON.parse(readFileSync('data/evaluation/frozen-cases.json','utf8'))
const replay = currentReplay()
const cases = frozen.cases.map((entry: { path: string; sha256: string; synthetic: boolean }) => {
 const bytes = readFileSync(entry.path)
 if(hash(bytes) !== entry.sha256) throw new Error('Frozen case changed')
 const scenario = JSON.parse(bytes.toString())
 const input = entry.synthetic ? JSON.parse(readFileSync(entry.path.replace('.json','.input.json'),'utf8')).input : { place: loadPlaces().find(p=>p.id===scenario.placeId)!, snapshotId:scenario.snapshotId, mode:'replay', asOf:scenario.asOf, observations:replay.observations, source:sourceFromSnapshot(replay) }
 const context=buildPlaceContext(input)
 const instructions=voiceInstructions(context)
 return { scenario, caseSha256:entry.sha256, context, instructions, promptSha256:hash(instructions), tools:[contextTool] }
})
const output=process.argv[2] ?? 'artifacts/evaluation-inputs.json'
mkdirSync(path.dirname(output),{recursive:true})
writeFileSync(output,JSON.stringify({cases},null,2))
console.log('Exported',cases.length,'frozen cases without changing them')
