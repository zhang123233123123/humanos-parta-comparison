import hashlib
import hmac
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from copy import deepcopy
from unittest.mock import patch
from urllib.error import HTTPError

from backend.app.application.part_a.planning import build_preview, validate_output, PartAError
from backend.app.application.part_a.service import PartAService
from backend.app.infrastructure.part_a_runtime import completion
from backend.app.http.routes.part_a import part_a

ROOT = Path(__file__).resolve().parents[2]/'PartA预实验'


class PartATest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'runs.db'
        self.service=PartAService(ROOT,self.path,'mock-model',self.good_completion)
        self.catalog=self.service.catalog()
        self.scenario=next(s for s in self.catalog['scenarios'] if s['scenario_id']=='S1-L')
        self.person=next(p for p in self.catalog['profiles'] if p['participant']=='A02')
        self.payload={'scenario_id':'S1-L','profile_id':'A02','difficulty_mode':'level',
                      'difficulties':{t['task_id']:'high' for t in self.scenario['tasks']}}
    def tearDown(self):
        self.service.pool.shutdown(wait=True)
        self.tmp.cleanup()
    def good_output(self):
        d=self.person['first_day_context']['date']
        def block(t,a,b):return {'task_id':f'S1-0{t}','start_at':d+'T'+a+':00+08:00','end_at':d+'T'+b+':00+08:00'}
        return {'blocks':[block(1,'09:00','09:45'),block(2,'09:45','10:30'),block(2,'10:45','11:00'),block(3,'11:00','11:45'),block(4,'13:00','14:00'),block(5,'14:15','14:45')], 'explanation':'test only'}
    def good_completion(self,messages):
        output=self.good_output()
        return {'request':{'model':'mock-model','messages':deepcopy(messages)},'output':output,'raw_content':json.dumps(output)}
    def start(self, key='unique_request'):
        payload={**self.payload,'preview_hash':self.service.preview(self.payload)['preview_hash'],'request_id':key}
        return payload,self.service.start('researcher',payload)
    def wait(self, run):
        for _ in range(500):
            r=self.service.get('researcher',run['id'])
            if r['status']!='running':return r
            time.sleep(.01)
        self.fail('run never finished')
    def test_conditions_share_context_and_no_profile_leak(self):
        preview=self.service.preview(self.payload)
        facts=[json.loads(c['messages'][1]['content']) for c in preview['conditions']]
        self.assertEqual(facts[0],facts[1]); self.assertNotIn('perceived_difficulty',facts[1])
        self.assertNotIn('work_profile',facts[2]);self.assertIn('work_profile',facts[3])
        self.assertEqual(facts[2]['perceived_difficulty'],facts[3]['perceived_difficulty'])
        for f in facts:
            f.pop('work_profile',None);f.pop('perceived_difficulty',None)
            self.assertEqual(f,preview['common'])
    def test_difficulty_modes_and_invalid_values(self):
        for mode,good,bad in [('level','low','extreme'),('score',0,101),('text','感觉较难',' ')]:
            p={**self.payload,'difficulty_mode':mode,'difficulties':dict.fromkeys(self.payload['difficulties'],good)}
            self.service.preview(p)
            p['difficulties']['S1-01']=bad
            with self.assertRaises(PartAError):self.service.preview(p)
        for bad in [True,1.5,'30',-1]:
            p={**self.payload,'difficulty_mode':'score','difficulties':dict.fromkeys(self.payload['difficulties'],bad)}
            with self.assertRaises(PartAError):self.service.preview(p)
    def test_first_day_not_current_date(self):
        p=self.service.preview(self.payload)
        self.assertEqual(p['common']['date'],self.person['first_day_context']['date'])
        self.assertTrue(all(t['deadline_at'].startswith(p['common']['date']) for t in p['common']['tasks']))
    def test_validation_and_missing_tasks(self):
        p=self.service.preview(self.payload);o=self.good_output()
        self.assertTrue(validate_output(p['common'],o)['valid'])
        self.assertTrue(validate_output(p['common'],o)['blocks'][0]['start_at'].endswith('+08:00'))
        o['blocks'].pop();self.assertFalse(validate_output(p['common'],o)['valid'])
    def test_time_constraints(self):
        common=self.service.preview(self.payload)['common']
        d=common['date']
        variants=[('start_at',d+'T09:00:01+08:00'),('start_at',d+'T09:00:00'),('start_at',d+'T08:00:00+08:00'),('end_at',d+'T23:00:00+08:00'),('task_id','invented')]
        for key,val in variants:
            o=self.good_output();o['blocks'][0][key]=val
            self.assertFalse(validate_output(common,o)['valid'],(key,val))
        o=self.good_output();o['blocks'][1].update(start_at=d+'T09:15:00+08:00',end_at=d+'T10:00:00+08:00')
        self.assertFalse(validate_output(common,o)['valid'])
        o=self.good_output();o['blocks'][-1].update(start_at=d+'T12:00:00+08:00',end_at=d+'T12:30:00+08:00')
        self.assertFalse(validate_output(common,o)['valid'])
    def test_precheck_blocks_impossible_before_model(self):
        self.payload['duration_overrides']=dict.fromkeys(self.payload['difficulties'],1440)
        p=self.service.preview(self.payload);self.assertFalse(p['precheck']['can_attempt'])
        with self.assertRaises(PartAError):self.start()
        self.payload.pop('duration_overrides');self.payload['profile_id']='A01'
        self.assertFalse(self.service.preview(self.payload)['precheck']['can_attempt'])
    def test_run_persists_idempotency_and_ownership(self):
        p,r=self.start();r=self.wait(r)
        self.assertEqual(r['status'],'completed')
        self.assertEqual(len(r['results']),4)
        self.assertEqual(self.service.start('researcher',p)['id'],r['id'])
        with self.assertRaises(PartAError):self.service.start('researcher',{**p,'profile_id':'A03'})
        with self.assertRaises(PartAError):self.service.get('intruder',r['id'])
        self.assertEqual(self.service.list('intruder'),[])
    def test_stale_preview(self):
        p={**self.payload,'preview_hash':'wrong','request_id':'unique_id'}
        with self.assertRaises(PartAError) as ctx:self.service.start('researcher',p)
        self.assertEqual(ctx.exception.status,409)
    def test_repair_preserves_actual_requests(self):
        def repaired(messages):
            if len(messages)==2:return {'output':{'blocks':[]},'raw_content':'{"blocks":[]}','request':{'messages':deepcopy(messages)}}
            return self.good_completion(messages)
        self.service.complete=repaired
        _,r=self.start();r=self.wait(r)
        self.assertEqual(r['status'],'completed')
        for c in r['results']:
            self.assertEqual(len(c['attempts']),2)
            self.assertEqual(c['attempts'][1]['request']['messages'][2]['role'],'assistant')
            self.assertIn('质检',c['attempts'][1]['request']['messages'][3]['content'])
    def test_failures_not_success(self):
        self.service.complete=lambda _: {'error':'HTTP 402'}
        _,r=self.start();r=self.wait(r)
        self.assertEqual(r['status'],'completed_with_errors')
        self.assertTrue(all(c['status']=='error' and len(c['attempts'])==1 for c in r['results']))
    def test_invalid_attempts_bounded(self):
        self.service.complete=lambda _: {'output':{'blocks':[]},'raw_content':'{"blocks":[]}'}
        _,r=self.start();r=self.wait(r)
        self.assertTrue(all(c['status']=='invalid' and len(c['attempts'])==3 for c in r['results']))
    def test_restarts_mark_interrupted(self):
        _,r=self.start();r=self.wait(r);r['status']='running';r['results'][0]['status']='running'
        with self.service.db() as db,db:db.execute('UPDATE parta_runs SET body=? WHERE id=?',(json.dumps(r),r['id']))
        other=PartAService(ROOT,self.path,'mock-model',self.good_completion)
        try:self.assertEqual(other.get('researcher',r['id'])['status'],'interrupted')
        finally:other.pool.shutdown()
    def test_capture_exact_body_without_key(self):
        def open_url(req,timeout):
            self.assertEqual(req.get_header('Authorization'),'Bearer secret_test')
            return io.BytesIO(json.dumps({'model':'mock-model','choices':[{'message':{'content':'{"blocks":[]}'}}]}).encode())
        call=completion({'DEEPSEEK_API_KEY':'secret_test','DEEPSEEK_MODEL':'mock-model'},open_url)
        r=call([{'role':'user','content':'hello'}])
        self.assertEqual(r['request']['messages'][0]['content'],'hello')
        self.assertEqual(r['request']['temperature'],.2)
        self.assertNotIn('secret_test',json.dumps(r))
    def test_http_role_and_signature(self):
        class Store:
            def user_row(self,actor):return {'id':actor}
        class Request:
            path='/api/part-a/catalog'
            rfile=io.BytesIO(b'')
            headers={}
            def send_json(self,data,status=200):self.data=data;self.status=status
        secret='x'*32;r=Request();env={'HUMANOS_PARTA_MODE':'1','HUMANOS_PARTA_PROXY_SECRET':secret,'HUMANOS_PARTA_RESEARCHERS':'researcher'}
        with patch.dict('os.environ',env),patch('backend.app.http.routes.part_a.get_service',return_value=self.service):
            part_a(r,Store(),None,'GET',r.path,{})
            self.assertEqual(r.status,401)
            for actor,status in [('intruder',403),('researcher',200)]:
                stamp=str(int(time.time()));sig=hmac.new(secret.encode(),'\n'.join([stamp,actor,'GET',r.path,hashlib.sha256(b'').hexdigest()]).encode(),hashlib.sha256).hexdigest()
                r.headers={'X-Simulation-Actor':actor,'X-Simulation-Time':stamp,'X-Simulation-Signature':sig}
                part_a(r,Store(),None,'GET',r.path,{})
                self.assertEqual(r.status,status)

    def test_link_actor_requires_signed_exact_identity_without_user(self):
        class Store:
            def user_row(self, actor): return None
        class Request:
            path='/api/part-a/catalog'
            rfile=io.BytesIO(b'')
            headers={}
            def send_json(self,data,status=200): self.data=data;self.status=status
        actor='parta_link_'+'a'*32;secret='x'*32
        env={'HUMANOS_PARTA_MODE':'1','HUMANOS_PARTA_PROXY_SECRET':secret,
             'HUMANOS_PARTA_LINK_ACTOR':actor,'HUMANOS_PARTA_RESEARCHERS':''}
        with patch.dict('os.environ',env),patch('backend.app.http.routes.part_a.get_service',return_value=self.service):
            for identity,sign,status in [(actor,False,401),(actor,True,200),('parta_link_'+'b'*32,True,401)]:
                r=Request();stamp=str(int(time.time()))
                signature=hmac.new(secret.encode(),'\n'.join([stamp,identity,'GET',r.path,hashlib.sha256(b'').hexdigest()]).encode(),hashlib.sha256).hexdigest() if sign else ''
                r.headers={'X-Simulation-Actor':identity,'X-Simulation-Time':stamp,'X-Simulation-Signature':signature}
                part_a(r,Store(),None,'GET',r.path,{})
                self.assertEqual(r.status,status)

    def test_deadline_overrides_shared_immutable_and_precheck(self):
        original=deepcopy(self.scenario)
        payload={**self.payload,'profile_id':'A01'}
        before=self.service.preview(payload)
        self.assertFalse(before['precheck']['can_attempt'])
        payload['deadline_overrides']={t['task_id']:'22:00' for t in self.scenario['tasks']}
        after=self.service.preview(payload)
        self.assertTrue(after['precheck']['can_attempt'])
        self.assertNotEqual(before['preview_hash'],after['preview_hash'])
        for condition in after['conditions']:
            facts=json.loads(condition['messages'][1]['content'])
            self.assertEqual(facts['tasks'],after['common']['tasks'])
            for task in facts['tasks']:
                self.assertEqual(task['deadline_at'],after['common']['date']+'T22:00:00+08:00')
        self.assertEqual(self.scenario,original)
        self.assertEqual(self.service.preview({**self.payload,'profile_id':'A01'})['preview_hash'],before['preview_hash'])

    def test_deadline_partial_legacy_and_invalid_values(self):
        baseline=self.service.preview(self.payload)
        self.assertEqual(self.service.preview({**self.payload,'deadline_overrides':{}})['preview_hash'],baseline['preview_hash'])
        partial=self.service.preview({**self.payload,'deadline_overrides':{'S1-01':'23:59'}})
        self.assertEqual(partial['common']['tasks'][0]['deadline_at'][11:16],'23:59')
        self.assertEqual(partial['common']['tasks'][1:],baseline['common']['tasks'][1:])
        invalid=[None,[],{'unknown':'18:00'}]
        invalid += [{'S1-01':x} for x in ['',None,True,1800,'9:00','24:00','12:60','18:00:00','2026-10-16T18:00','09:00','08:59']]
        for deadlines in invalid:
            with self.subTest(deadlines=deadlines),self.assertRaises(PartAError):
                self.service.preview({**self.payload,'deadline_overrides':deadlines})

    def test_changed_deadline_rejects_stale_preview_before_completion(self):
        preview=self.service.preview(self.payload)
        self.service.complete=lambda _: self.fail('Model must not be called')
        with self.assertRaises(PartAError) as caught:
            self.service.start('researcher',{**self.payload,'deadline_overrides':{'S1-01':'22:00'},
                'preview_hash':preview['preview_hash'],'request_id':'changed_deadline'})
        self.assertEqual(caught.exception.status,409)
        self.assertEqual(self.service.list('researcher'),[])

    def test_deadline_override_saved_and_used_by_output_validator(self):
        self.payload['deadline_overrides']={'S1-01':'09:30'}
        preview=self.service.preview(self.payload)
        self.assertFalse(validate_output(preview['common'],self.good_output())['valid'])
        self.payload['deadline_overrides']={'S1-01':'22:00'}
        _,r=self.start('deadline_saved');r=self.wait(r)
        self.assertEqual(r['status'],'completed')
        self.assertEqual(r['input']['deadline_overrides'],{'S1-01':'22:00'})
        self.assertEqual(r['preview']['common']['tasks'][0]['deadline_at'][11:16],'22:00')

if __name__=='__main__':unittest.main()
