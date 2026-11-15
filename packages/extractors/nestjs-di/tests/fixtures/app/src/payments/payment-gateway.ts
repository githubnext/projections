/** The contract orders depend on; an abstract class is a usable runtime token. */
export abstract class PaymentGateway {
  abstract charge(amount: number): Promise<string>;
}
