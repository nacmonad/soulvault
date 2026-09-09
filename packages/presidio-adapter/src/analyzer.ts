import { AnalyzerEngine, IbanRecognizer, PatternRecognizer, PhoneRecognizer, RecognizerRegistry } from 'presidio-web';
import { indexFindings, mergeFindings, type AnalyzerFinding } from './findings.js';

const engine = new AnalyzerEngine({ registry: new RecognizerRegistry([
  new IbanRecognizer(),
  new PhoneRecognizer(),
  new PatternRecognizer({ name: 'CreditCardRecognizer', supportedEntity: 'CREDIT_CARD', context: ['card', 'credit', 'payment'], patterns: [{ name: 'card number', regex: '\\b(?:\\d[ -]*?){13,16}\\b', score: 0.3 }] }),
  new PatternRecognizer({ name: 'EmailRecognizer', supportedEntity: 'EMAIL_ADDRESS', patterns: [{ name: 'email', regex: '\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b', score: 0.85 }] }),
]) });

type PresidioResult = { entityType: string; start: number; end: number; score: number; analysisExplanation?: { recognizer?: string } };

export function analyzeText(text: string, semanticFindings: AnalyzerFinding[] = []) {
  const patterns = (engine.analyze(text, 'en') as PresidioResult[]).map((item) => ({ ...item, source: 'presidio' as const, recognizer: item.analysisExplanation?.recognizer }));
  return indexFindings(text, mergeFindings(patterns, semanticFindings));
}
