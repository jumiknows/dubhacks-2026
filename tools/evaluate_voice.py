import argparse, asyncio, base64, datetime, getpass, hashlib, json, re, subprocess, time
from pathlib import Path
import websockets

root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description='Bounded paid Voice evaluation of frozen cases, without a browser or microphone')
parser.add_argument('--inputs', default=str(root/'artifacts/evaluation-inputs.json'))
parser.add_argument('--run-id', required=True)
args=parser.parse_args()
if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,80}', args.run_id): parser.error('Use a short lowercase run ID')
packet=json.loads(Path(args.inputs).read_text())
key=getpass.getpass('xAI key for bounded offline evaluation (hidden): ')
run=args.run_id
out=root/'data/evaluation/responses'/run
out.mkdir(parents=True,exist_ok=False)
model='grok-voice-latest'
summary={'runId':run,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'applicationCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'workingTreeChanges':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'method':'Offline WebSocket protocol evaluation using the revised application prompt and frozen deterministic contexts','modelRequested':model,'maxCases':12,'maxSecondsPerCase':90,'cases':[],'humanReviews':[],'limitations':['No browser playback or microphone permission tested','Synthetic contexts supplied only by this offline harness','Context-switch case closes this harness connection, not the application browser','No factual pass rate until human review','Original holdout was inspected before this regression run and is no longer an untouched holdout']}
def save(path,value):
 text=json.dumps(value,indent=2)+'\n'
 if key in text: raise ValueError('secret in output')
 path.write_text(text)
async def run_case(item):
 scenario=item['scenario']; case=scenario['caseId']
 result={'caseId':case,'caseSha256':item['caseSha256'],'synthetic':scenario['synthetic'],'split':scenario['split'],'question':scenario['question'],'modelRequested':model,'voice':'eve','promptSha256':item['promptSha256'],'instructions':item['instructions'],'context':item['context'],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'transcript':'','toolCalls':[],'eventTypes':[],'audioBytes':0,'responsesCompleted':0,'humanReviews':[]}
 audiohash=hashlib.sha256(); first_audio=None; max_queue=0; pending=False; asked=False; seen=set(); started=time.monotonic()
 try:
  async with asyncio.timeout(90):
   async with websockets.connect('wss://api.x.ai/v1/realtime?model='+model,additional_headers={'Authorization':'Bearer '+key},open_timeout=15,close_timeout=3,max_size=2**22) as ws:
    config={'voice':'eve','instructions':item['instructions'],'tools':item['tools'],'turn_detection':{'type':'server_vad'},'audio':{'input':{'format':{'type':'audio/pcm','rate':24000}},'output':{'format':{'type':'audio/pcm','rate':24000}}}}
    await ws.send(json.dumps({'type':'session.update','session':config}))
    async for raw in ws:
     event=json.loads(raw); kind=event.get('type','unknown')
     if kind not in result['eventTypes']: result['eventTypes'].append(kind)
     if kind=='session.created': result['modelReported']=event.get('session',{}).get('model')
     if kind=='session.updated' and not asked:
      asked=True
      await ws.send(json.dumps({'type':'conversation.item.create','item':{'type':'message','role':'user','content':[{'type':'input_text','text':scenario['question']}]}}))
      await ws.send(json.dumps({'type':'response.create'}))
     if kind=='error':
      error=event.get('error',{}); result['providerError']={k:error.get(k) for k in ['type','code','message']}; break
     if kind in ['response.output_audio.delta','response.audio.delta']:
      audio=base64.b64decode(event['delta']); audiohash.update(audio); result['audioBytes']+=len(audio)
      if first_audio is None: first_audio=time.monotonic()
      max_queue=max(max_queue,result['audioBytes']/48000-(time.monotonic()-first_audio))
      if case=='context-switch':
       result['cancelledAfterFirstAudio']=True
       await ws.close(); break
     if kind in ['response.output_audio_transcript.delta','response.audio_transcript.delta','response.text.delta']: result['transcript']+=event.get('delta','')
     if kind=='response.function_call_arguments.done':
      call_id=event['call_id']
      if call_id in seen: continue
      seen.add(call_id)
      if len(seen)>4: raise ValueError('tool-call bound')
      args=json.loads(event['arguments'])
      expected={k:item['context'][k] for k in ['placeId','snapshotId','asOf']}
      if event.get('name')!='get_place_context' or args!=expected: output={'error':{'code':'context-mismatch','message':'Use only the selected place, snapshot and time'}}
      elif case=='unknown-snapshot': output={'error':{'code':'unavailable-snapshot','message':'The requested snapshot is not available. Do not substitute another snapshot.'}}
      else: output=item['context']
      result['toolCalls'].append({'name':event.get('name'),'arguments':args,'output':output})
      await ws.send(json.dumps({'type':'conversation.item.create','item':{'type':'function_call_output','call_id':call_id,'output':json.dumps(output)}}))
      pending=True
     if kind=='response.done':
      result['responsesCompleted']+=1
      if pending: pending=False; await ws.send(json.dumps({'type':'response.create'}))
      elif result['transcript'] or result['audioBytes']: break
 except Exception as error:
  result['errorType']=type(error).__name__
  if isinstance(error,websockets.exceptions.InvalidStatus): result['websocketHttpStatus']=error.response.status_code
 result['audioSha256']=audiohash.hexdigest(); result['generatedAudioSeconds']=round(result['audioBytes']/48000,3)
 result['maxEstimatedPlaybackQueueSeconds']=round(max_queue,3)
 result['elapsedSeconds']=round(time.monotonic()-started,3)
 result['transportCompleted']=bool(result['transcript'] and result['responsesCompleted'] and not result.get('providerError') and not result.get('errorType'))
 save(out/(case+'.json'),result)
 return {k:result.get(k) for k in ['websocketHttpStatus','caseId','synthetic','split','transportCompleted','cancelledAfterFirstAudio','errorType','generatedAudioSeconds','maxEstimatedPlaybackQueueSeconds','elapsedSeconds']}
async def main():
 for item in packet['cases'][:12]:
  result=await run_case(item)
  summary['cases'].append(result)
  save(out/'run.json',summary)
  print(json.dumps(result),flush=True)
  if result.get('websocketHttpStatus') in [401,403,429]: break
 summary['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 summary['completedResponses']=sum(bool(x['transportCompleted']) for x in summary['cases'])
 summary['cancelledCases']=sum(bool(x.get('cancelledAfterFirstAudio')) for x in summary['cases'])
 save(out/'run.json',summary)
asyncio.run(main())
